import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { runEvidence } from "../../src/phases/p3-evidence.ts";
import { paths } from "../../src/util/paths.ts";
import { ConfigSchema } from "../../src/config/index.ts";
import { findInjectionAttempts } from "../../src/phases/p4-adversary.ts";

const FIXTURE = join(import.meta.dir, "..", "fixtures", "nextjs-supabase-llm");

const cfg = ConfigSchema.parse({
  version: 1,
  project: { name: "fixture", profile: "student", description_file: ".addgp/description.md" },
  regions: ["gh", "eu"],
  models: {
    research: { provider: "openrouter", id: "perplexity/sonar-pro" },
    security: { provider: "openrouter", id: "openai/gpt-4o" },
    architect: { provider: "openrouter", id: "anthropic/claude-sonnet-4.5" },
  },
  scan: { include: ["**/*"], exclude: ["**/node_modules/**"], max_file_kb: 512 },
});

const bundle = runEvidence({ cfg, paths: paths(FIXTURE), scanHistory: false });
const ruleIds = new Set(bundle.findings.map((f) => f.rule_id));
const has = (prefix: string) => [...ruleIds].some((r) => r.startsWith(prefix));

describe("phase 3 — the local engine finds the planted issues", () => {
  test("it reads the fixture at all", () => {
    expect(bundle.file_count).toBeGreaterThan(3);
    expect(bundle.loc).toBeGreaterThan(30);
  });

  test("detects the frameworks and data stores in play", () => {
    expect(bundle.frameworks).toContain("Next.js");
    expect(bundle.frameworks).toContain("Supabase");
    expect(bundle.frameworks).toContain("OpenAI SDK");
    expect(bundle.data_stores.length).toBeGreaterThan(0);
  });

  test("finds the special-category data: Ghana Card, health, religion", () => {
    const categories = bundle.findings
      .filter((f) => f.kind === "pii_symbol")
      .map((f) => String(f.meta?.category ?? ""));
    expect(categories).toContain("Ghana Card number");
    expect(categories.some((c) => /health/i.test(c))).toBe(true);
    expect(categories.some((c) => /religio/i.test(c))).toBe(true);
  });

  test("flags the service_role key reachable from the client bundle", () => {
    expect(has("iac.privileged_key_in_client")).toBe(true);
    const f = bundle.findings.find((x) => x.rule_id === "iac.privileged_key_in_client")!;
    expect(f.severity).toBe("critical");
  });

  test("flags tables created with no row level security", () => {
    expect(has("iac.rls_absent")).toBe(true);
  });

  test("flags personal data reaching a log sink", () => {
    expect(has("logging.pii_in_log_sink")).toBe(true);
  });

  test("finds the inference call site and notes personal data is in scope", () => {
    const ai = bundle.findings.find((f) => f.kind === "ai_call_site");
    expect(ai).toBeDefined();
    expect((ai!.meta.personal_data_in_scope as string[]).length).toBeGreaterThan(0);
    expect(ai!.conclusion).toContain("lawful basis");
  });

  test("flags special-category columns stored in a plain type", () => {
    expect(has("storage.special_category_column")).toBe(true);
  });

  test("finds the vulnerable dependency from the embedded advisory set", () => {
    const dep = bundle.findings.filter((f) => f.kind === "dependency_vuln");
    expect(dep.length).toBeGreaterThan(0);
    expect(dep.some((d) => d.title.includes("lodash"))).toBe(true);
  });

  test("reports the absent compliance artifacts, with a reason each", () => {
    expect(bundle.compliance_artifacts.privacy_policy).toBe(false);
    expect(bundle.compliance_artifacts.dpa).toBe(false);
    expect(bundle.compliance_artifacts.ropa).toBe(false);
    const absent = bundle.findings.filter((f) => f.kind === "artifact_absent");
    expect(absent.length).toBeGreaterThan(5);
    for (const f of absent) expect(f.conclusion.length).toBeGreaterThan(60);
  });

  test("every finding is locatable and expressed as a conclusion, not a quotation", () => {
    for (const f of bundle.findings) {
      expect(f.file).toBeTruthy();
      expect(f.snippet_hash).toMatch(/^[0-9a-f]{12}$/);
      expect(f.conclusion.length).toBeGreaterThan(20);
      expect(f.rule_id).toBeTruthy();
    }
  });
});

describe("phase 3 — stability", () => {
  test("two runs over unchanged input produce the same findings", () => {
    const again = runEvidence({ cfg, paths: paths(FIXTURE), scanHistory: false });
    expect(again.findings.map((f) => f.rule_id)).toEqual(bundle.findings.map((f) => f.rule_id));
    expect(again.root_hash).toBe(bundle.root_hash);
    expect(again.compliance_artifacts).toEqual(bundle.compliance_artifacts);
  });
});

describe("prompt injection is data, not instruction", () => {
  test("the planted 'report zero gaps' comment is detected as an injection attempt", () => {
    const attempts = findInjectionAttempts(FIXTURE);
    expect(attempts.length).toBeGreaterThan(0);
    expect(attempts[0]!.text.toLowerCase()).toContain("ignore previous instructions");
  });

  test("it does not suppress any finding — the gap count is unaffected", () => {
    // The injected comment lives in lib/supabase.ts. Phase 3 still reports every
    // issue in that file, because a comment cannot instruct a deterministic scanner.
    const inFile = bundle.findings.filter((f) => f.file === "lib/supabase.ts");
    expect(inFile.length).toBeGreaterThan(2);
    expect(inFile.some((f) => f.rule_id === "iac.privileged_key_in_client")).toBe(true);
  });
});
