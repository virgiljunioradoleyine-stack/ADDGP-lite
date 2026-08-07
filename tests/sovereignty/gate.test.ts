import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gateEgress, EgressBlocked, assertPinnedUrl, isPinnedHost } from "../../src/sovereignty/gate.ts";
import { sealPayload } from "../../src/sovereignty/seal.ts";
import { denyCheck } from "../../src/sovereignty/denylist.ts";
import { findForbidden, findSecrets, findPii } from "../../src/sovereignty/secrets.ts";
import { paths } from "../../src/util/paths.ts";
import { PINNED_HOSTS } from "../../src/brand.ts";

const p = paths(mkdtempSync(join(tmpdir(), "addgp-gate-")));
const opts = { paths: p, runId: "test", phase: 4, neverSend: [], record: false as const };

function payloadWith(content: string, represents: string[] = ["src/x.ts"]) {
  return sealPayload({
    messages: [{ role: "user", content }],
    represents,
    level: 1,
    purpose: "test",
  });
}

/* ───────────────────────── leak tests ───────────────────────── */

const PLANTED: [string, string][] = [
  ["OpenAI key", 'const k = "sk-proj-aBcD1234efGH5678ijKL9012mnOP3456";'],
  ["Anthropic key", 'const k = "sk-ant-api03-9zZyXwVuTsRqPoNmLkJiHgFeDcBa0123456789";'],
  ["AWS access key id", "AKIAIOSFODNN7EXAMPLE"],
  ["GitHub token", "ghp_16CharsAndMoreHere0123456789abcdefgh"],
  ["Google API key", "AIzaSyD-1234567890abcdefghijklmnopqrstuv"],
  ["Stripe secret key", "sk_live_51H8xkLmNoPqRsTuVwXyZ0123"],
  ["private key block", "-----BEGIN RSA PRIVATE KEY-----\nMIIEow==\n-----END RSA PRIVATE KEY-----"],
  ["database URL with password", "postgres://admin:hunter2secret@db.internal:5432/prod"],
  ["JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"],
  ["email address", "kwame.asante@clinic.com.gh"],
  ["Ghana Card number", "GHA-123456789-0"],
  ["Nigerian BVN", "bvn: 12345678901"],
  ["payment card number", "4111111111111111"],
  ["US Social Security number", "123-45-6789"],
  ["Aadhaar number", "aadhaar 1234 5678 9012"],
];

describe("egress gate — planted secrets and personal data abort the run", () => {
  for (const [label, content] of PLANTED) {
    test(`${label} is blocked`, () => {
      expect(() => gateEgress(payloadWith(content), "openrouter.ai", opts)).toThrow(EgressBlocked);
    });
  }

  test("the abort names the offending location and does not echo the secret", () => {
    try {
      gateEgress(payloadWith('const k = "sk-ant-api03-9zZyXwVuTsRqPoNmLkJiHgFeDcBa0123456789";'), "openrouter.ai", opts);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(EgressBlocked);
      const msg = (e as EgressBlocked).message;
      expect(msg).toContain("Anthropic API key");
      expect(msg).toContain("src/x.ts");
      // the value itself never appears, only an excerpt
      expect(msg).not.toContain("9zZyXwVuTsRqPoNmLkJiHgFeDcBa0123456789");
    }
  });

  test("it aborts rather than cleaning and continuing", () => {
    const before = findForbidden("AKIAIOSFODNN7EXAMPLE").length;
    expect(before).toBeGreaterThan(0);
    expect(() => gateEgress(payloadWith("AKIAIOSFODNN7EXAMPLE"), "openrouter.ai", opts)).toThrow();
  });

  test("a clean payload passes and is recorded in the ledger", () => {
    const rec = gateEgress(payloadWith("const v_a1 = createClient(process.env.URL);"), "openrouter.ai", opts);
    expect(rec.destination).toBe("openrouter.ai");
    expect(rec.payload_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.files_represented).toEqual(["src/x.ts"]);
    expect(rec.sovereignty_level).toBe(1);
  });
});

describe("egress gate — destination pinning", () => {
  test("only the pinned host is permitted", () => {
    expect(PINNED_HOSTS).toEqual(["openrouter.ai"]);
    expect(isPinnedHost("openrouter.ai")).toBe(true);
    expect(isPinnedHost("api.openai.com")).toBe(false);
    expect(isPinnedHost("evil.example.com")).toBe(false);
  });

  test("any other host is blocked as a bug, not a configuration problem", () => {
    expect(() => gateEgress(payloadWith("clean"), "evil.example.com", opts)).toThrow(EgressBlocked);
    expect(() => assertPinnedUrl("https://evil.example.com/v1/chat")).toThrow(EgressBlocked);
  });

  test("non-HTTPS is refused", () => {
    expect(() => assertPinnedUrl("http://openrouter.ai/api/v1/chat/completions")).toThrow(EgressBlocked);
  });

  test("a lookalike host does not pass", () => {
    expect(() => assertPinnedUrl("https://openrouter.ai.evil.com/v1")).toThrow(EgressBlocked);
    expect(assertPinnedUrl("https://openrouter.ai/api/v1/chat/completions")).toBe("openrouter.ai");
  });
});

describe("egress gate — the deny-list runs against the final payload too", () => {
  test("a payload representing a denied path is blocked even if its text is clean", () => {
    expect(() => gateEgress(payloadWith("clean content", [".env"]), "openrouter.ai", opts)).toThrow(EgressBlocked);
    expect(() => gateEgress(payloadWith("clean content", ["config/private.pem"]), "openrouter.ai", opts)).toThrow(EgressBlocked);
    expect(() => gateEgress(payloadWith("clean content", ["data/users.csv"]), "openrouter.ai", opts)).toThrow(EgressBlocked);
  });

  test("a user never_send pattern is honoured", () => {
    expect(() =>
      gateEgress(payloadWith("clean", ["src/proprietary/engine.ts"]), "openrouter.ai", {
        ...opts,
        neverSend: ["**/proprietary/**"],
      }),
    ).toThrow(EgressBlocked);
  });
});

describe("deny-list — §5.3, never sent at any level", () => {
  const denied = [
    ".env", ".env.local", "app/.env.production",
    "certs/server.pem", "keys/id_rsa", "config/keystore.jks",
    "secrets/tokens.json", "credentials/aws.json",
    "package-lock.json", "yarn.lock", "poetry.lock", "go.sum",
    "data/users.csv", "fixtures/patients.json", "db/seeds/users.sql",
    "analysis/notebook.ipynb", "backup/dump.sql", "exports/rows.parquet",
    "assets/logo.png", "node_modules/x/index.js", ".git/config",
    ".addgp/sovereign/map.json",
  ];
  for (const path of denied) {
    test(`${path} is refused`, () => {
      expect(denyCheck(path).denied).toBe(true);
      expect(denyCheck(path).explanation).toBeTruthy();
    });
  }

  const allowed = ["src/index.ts", "app/api/route.ts", "lib/db.py", "infra/main.tf", "schema.sql"];
  for (const path of allowed) {
    test(`${path} is allowed through the redactor`, () => {
      expect(denyCheck(path).denied).toBe(false);
    });
  }

  test("no customer or user data is ever sent, in any form, at any level", () => {
    for (const ext of [".csv", ".parquet", ".jsonl", ".xlsx", ".sqlite"]) {
      expect(denyCheck(`anywhere/rows${ext}`).denied).toBe(true);
    }
  });
});

describe("detectors — false positives kept out of the way", () => {
  test("documentation and placeholder addresses are not treated as personal data", () => {
    expect(findPii("user@example.com")).toEqual([]);
    expect(findPii("noreply@company.com")).toEqual([]);
  });

  test("an environment-variable reference is not a hardcoded credential", () => {
    expect(findSecrets('const key = "process.env.API_KEY";')).toEqual([]);
    expect(findSecrets('api_key: "YOUR_API_KEY_HERE"')).toEqual([]);
  });

  test("a number that fails Luhn is not a card number", () => {
    expect(findPii("4111111111111112").filter((h) => h.rule === "card_number")).toEqual([]);
  });

  test("a long URL or import path is not a high-entropy secret", () => {
    // Regression: these tripped the entropy rule and aborted runs on clean code.
    expect(findSecrets("https://github.com/virgiljunioradoleyine-stack/addgp-lite")).toEqual([]);
    expect(findSecrets('import x from "@company-name/some-package/deep/sub-path";')).toEqual([]);
    expect(findSecrets("https://www.dataprotection.org.gh/data-protection/data-protection-acts-2012")).toEqual([]);
    expect(findSecrets("registry.example.org/organisation-name/repository-name")).toEqual([]);
  });

  test("but a secret that happens to contain a slash is still caught", () => {
    // base64 uses "/", so the path exemption must not become a bypass
    expect(findSecrets("aWQ9MTIzNDU2Nzg5/c2VjcmV0S2V5VmFsdWU5OTk=").length).toBeGreaterThan(0);
    expect(findSecrets("https://api.example.com/v1?token=aGVsbG8gd29ybGQgc2VjcmV0IHRva2Vu").length).toBeGreaterThan(0);
    expect(findSecrets("AKIAIOSFODNN7EXAMPLE").length).toBeGreaterThan(0);
  });
});
