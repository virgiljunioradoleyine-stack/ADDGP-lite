import { describe, expect, test } from "bun:test";
import { redactFile, classifyLiteral, bucketNumber } from "../../src/sovereignty/redactor.ts";
import { PseudonymMap } from "../../src/sovereignty/pseudonym.ts";
import { rehydrate } from "../../src/sovereignty/rehydrate.ts";
import { findForbidden } from "../../src/sovereignty/secrets.ts";

const SOURCE = `import { createClient } from "@supabase/supabase-js";
// pricing tier logic — do not share
export async function calculateEnterpriseTier(customerId: string) {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data } = await supabase.from("users").select("ghana_card_number, email");
  const enterpriseFloor = 125000;
  const contactEmail = "kofi.mensah@viradotech.com";
  return { data, enterpriseFloor, contactEmail };
}
`;

function opts(map: PseudonymMap, level: 0 | 1 | 2 = 1, keepComments = false) {
  return {
    level,
    keepComments,
    terms: ["ViradoTech", "*.viradotech.com"],
    deps: new Set(["@supabase/supabase-js", "supabase-js"]),
    map,
  };
}

describe("redactor — level 1 (pseudonymised, the default)", () => {
  const map = PseudonymMap.ephemeral("test-salt");
  const r = redactFile("src/billing/pricingEngine.ts", SOURCE, opts(map));

  test("user-defined identifiers do not survive", () => {
    expect(r.content).not.toContain("calculateEnterpriseTier");
    expect(r.content).not.toContain("customerId");
    expect(r.content).not.toContain("enterpriseFloor");
  });

  test("framework and dependency identifiers do survive, because the model needs them", () => {
    expect(r.content).toContain("createClient");
    expect(r.content).toContain("async");
    expect(r.content).toContain("@supabase/supabase-js");
    expect(r.content).toContain("select");
  });

  test("the real path never appears; the sealed path is pseudonymised", () => {
    expect(r.sealed_path).not.toContain("billing");
    expect(r.sealed_path).not.toContain("pricingEngine");
    expect(r.sealed_path).toMatch(/^mod_[a-z0-9]+\/mod_[a-z0-9]+\/svc_[a-z0-9]+\.ts$/);
  });

  test("comments are stripped by default — that is where the roadmap lives", () => {
    expect(r.content).not.toContain("do not share");
    expect(r.stats.comments_stripped).toBeGreaterThan(0);
  });

  test("literals become typed placeholders, and an email never survives", () => {
    expect(r.content).not.toContain("kofi.mensah@viradotech.com");
    expect(r.content).toContain("<str:email>");
  });

  test("table and column names in literals map to the same pseudonyms as the schema", () => {
    expect(r.content).not.toContain("ghana_card_number");
    // .from("users") and .select("ghana_card_number, email") keep their shape
    expect(r.content).toMatch(/\.from\("(?:tbl|col|v)_[a-z0-9]+"\)/);
    expect(map.symbol("ghana_card_number", "col")).toBeTruthy();
    expect(r.content).toContain(map.symbol("ghana_card_number", "col"));
  });

  test("numeric constants above the threshold are bucketed", () => {
    expect(r.content).not.toContain("125000");
    expect(r.stats.numbers_bucketed).toBeGreaterThan(0);
  });

  test("line structure is preserved so line numbers stay meaningful", () => {
    expect(r.content.split("\n").length).toBe(SOURCE.split("\n").length);
  });

  test("nothing forbidden survives into the redacted output", () => {
    expect(findForbidden(r.content)).toEqual([]);
  });
});

describe("redactor — level 0 (structural)", () => {
  const map = PseudonymMap.ephemeral("test-salt");
  const r = redactFile("src/billing/pricingEngine.ts", SOURCE, opts(map, 0));

  test("emits shape only: no literals at all", () => {
    expect(r.content).not.toContain("125000");
    expect(r.content).not.toContain("ghana_card_number");
    expect(r.content).not.toContain("kofi.mensah");
    expect(r.content).not.toContain("calculateEnterpriseTier");
  });

  test("keeps the call graph and the dependency names", () => {
    expect(r.content).toContain("calls:");
    expect(r.content).toContain("createClient");
    expect(r.content).toContain("@supabase/supabase-js");
  });

  test("is dramatically smaller than the original", () => {
    expect(r.content.length).toBeLessThan(SOURCE.length);
  });
});

describe("redactor — level 2 (verbatim, allowlist only)", () => {
  test("passes content through but still removes a planted secret", () => {
    const map = PseudonymMap.ephemeral("test-salt");
    const withSecret = SOURCE + `const key = "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";\n`;
    const r = redactFile("src/billing/pricingEngine.ts", withSecret, opts(map, 2));
    expect(r.content).toContain("calculateEnterpriseTier"); // verbatim
    expect(r.content).not.toContain("sk-ant-api03-AAAA");
    expect(r.dropped.length).toBeGreaterThan(0);
  });
});

describe("round trip", () => {
  test("rehydration returns the original names exactly", () => {
    const map = PseudonymMap.ephemeral("test-salt");
    const r = redactFile("src/billing/pricingEngine.ts", SOURCE, opts(map));
    const finding = `Issue in ${r.sealed_path}: ${map.symbol("calculateEnterpriseTier", "fn")} leaks ${map.symbol("ghana_card_number", "col")}`;
    const back = rehydrate(finding, map);
    expect(back).toBe(
      "Issue in src/billing/pricingEngine.ts: calculateEnterpriseTier leaks ghana_card_number",
    );
  });

  test("a longer pseudonym is never eaten by a shorter one", () => {
    const map = PseudonymMap.ephemeral("t");
    const a = map.symbol("alpha", "fn");
    const b = map.symbol("alphabeta", "fn");
    expect(rehydrate(`${a} and ${b}`, map)).toBe("alpha and alphabeta");
  });

  test("a pseudonym embedded in a larger word is left alone", () => {
    const map = PseudonymMap.ephemeral("t");
    const p = map.symbol("alpha", "fn");
    expect(rehydrate(`x${p}y`, map)).toBe(`x${p}y`);
  });

  test("the same symbol gets one pseudonym across kinds, so joins survive", () => {
    const map = PseudonymMap.ephemeral("t");
    expect(map.symbol("users", "tbl")).toBe(map.symbol("users", "var"));
  });

  test("pseudonyms are stable across runs with the same salt", () => {
    const a = PseudonymMap.ephemeral("same");
    const b = PseudonymMap.ephemeral("same");
    expect(a.symbol("chargeCustomer", "fn")).toBe(b.symbol("chargeCustomer", "fn"));
  });

  test("pseudonyms differ across projects with different salts", () => {
    const a = PseudonymMap.ephemeral("salt-a");
    const b = PseudonymMap.ephemeral("salt-b");
    expect(a.symbol("chargeCustomer", "fn")).not.toBe(b.symbol("chargeCustomer", "fn"));
  });
});

describe("literal classification", () => {
  test("secrets are dropped, not placeheld", () => {
    expect(classifyLiteral("sk-ant-api03-XXXXXXXXXXXXXXXXXXXXXXXXXX").dropped).toBe(true);
  });
  test("shape-preserving placeholders", () => {
    expect(classifyLiteral("kofi@example.gh").placeholder).toBe("<str:email>");
    expect(classifyLiteral("https://api.stripe.com/v1").placeholder).toBe("<str:url:external>");
    expect(classifyLiteral("http://localhost:3000").placeholder).toBe("<str:url:internal>");
    expect(classifyLiteral("SELECT * FROM users").placeholder).toContain("<str:sql");
    expect(classifyLiteral("/api/users/[id]").placeholder).toContain("<str:path");
  });
  test("protocol constants pass through, because they carry no IP", () => {
    expect(classifyLiteral("application/json").placeholder).toBe("application/json");
    expect(classifyLiteral("POST").placeholder).toBe("POST");
  });
  test("number bucketing keeps meaningful constants and hides pricing", () => {
    expect(bucketNumber("200", 1000)).toBeNull();
    expect(bucketNumber("5432", 1000)).toBeNull();
    expect(bucketNumber("125000", 1000)).toBe("<num:100000..1000000>");
  });
});
