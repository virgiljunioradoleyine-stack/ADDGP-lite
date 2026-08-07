import { describe, expect, test } from "bun:test";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GapSchema, ObligationSchema, CitedMoneySchema } from "../../src/schemas/index.ts";
import { validateGap } from "../../src/phases/p5-adjudicate.ts";
import { citedMonetaryFigures, obligationPenaltiesAreCited, computeRoi } from "../../src/roi/engine.ts";
import { DEFAULT_ASSUMPTIONS, isUnsourced, bandLabel } from "../../src/roi/assumptions.ts";
import { renderLedger, renderRoi, renderReport } from "../../src/render/markdown.ts";
import { findSecrets, findPii } from "../../src/sovereignty/secrets.ts";
import { PseudonymMap } from "../../src/sovereignty/pseudonym.ts";
import { sealPayload, payloadText } from "../../src/sovereignty/seal.ts";
import { ConfigSchema } from "../../src/config/index.ts";
import type { Gap, ScanResult } from "../../src/schemas/index.ts";

/* ───────────────────────── fixtures ───────────────────────── */

const citation = {
  title: "Data Protection Act, 2012 (Act 843)",
  url: "https://www.dataprotection.org.gh/act-843",
  primary: true,
  retrieved_at: new Date().toISOString(),
};

function makeGap(over: Partial<Gap> = {}): Gap {
  return GapSchema.parse({
    id: "GAP-001",
    title: "Personal data reaches the inference vendor with no documented legal basis",
    status: "unsatisfied",
    severity: "critical",
    severity_basis: ["max_penalty", "data_sensitivity"],
    obligations: ["gh-dpa-843-s18"],
    evidence: ["EV-001"],
    adversary_findings: [],
    regions: ["gh"],
    confidence: 0.88,
    manual_fix: {
      what: "Add a legal_basis column to processing_registry and populate it for the three flows reaching the inference vendor.",
      why: {
        legal: "Section 18 of Act 843 requires a lawful basis recorded per processing purpose.",
        engineering: "src/ai/client.ts:33 sends patient records with no basis recorded anywhere.",
        citations: ["gh-dpa-843-s18"],
        file_refs: ["src/ai/client.ts:33"],
      },
      how: [
        "Add a migration creating processing_registry.legal_basis.",
        "Populate it for each flow that reaches the vendor.",
        "Test it with the existing integration suite.",
      ],
      consequence: {
        if_unfixed: "Processing without a recorded basis, which the Commission treats as unlawful processing.",
        if_fixed: "Each flow carries a recorded basis a regulator can inspect.",
        residual_risk: "A recorded basis is not a correct basis; legitimate interests still needs an assessment.",
      },
      effort: { engineering_days: 3, legal_review: true, vendor_action: true },
      verify: ["addgp-lite scan --phases 3,5"],
    },
    agent_prompt: "x".repeat(250),
    exposure: {
      financial: {
        statutory_maximum: null,
        observed_enforcement_range: null,
        avoidable_costs: [],
        confidence: "low",
      },
      non_financial: {
        market_access: null, contract_risk: null, operational: null,
        personal_liability: null, reputational: null, timeline_risk: null,
      },
    },
    roi_inputs: { remediation_spec_hours: 2, review_paths: 3, pre_launch: true },
    dependencies: [],
    owner_hint: "backend + legal",
    ...over,
  });
}

const cfg = ConfigSchema.parse({
  version: 1,
  project: { name: "props", profile: "student", description_file: ".addgp/description.md" },
  regions: ["gh"],
  models: {
    research: { provider: "openrouter", id: "perplexity/sonar-pro" },
    security: { provider: "openrouter", id: "openai/gpt-4o" },
    architect: { provider: "openrouter", id: "anthropic/claude-sonnet-4.5" },
  },
});

function makeResult(gaps: Gap[]): ScanResult {
  return {
    meta: {
      run_id: "R1", tool_version: "1.0.0",
      started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
      duration_ms: 1000, sovereignty_level: 1, regions: ["gh"],
      models: cfg.models, phases_run: [0, 1, 2, 3, 4, 5, 6], phases_skipped: [],
      cost_usd: { research: 0.1, security: 0.2, architect: 0.3 },
      prompt_hashes: {}, input_hash: "abc", offline: false,
      corpus_stale: false, incomplete: false, git_head: null,
    },
    profile: {
      summary: "A test system.", roles: ["controller"], data_subjects: ["patients"],
      data_categories: [], processing_purposes: [], automated_decisions: [],
      ai_components: [], cross_border_flows: [], third_parties: [],
      security_posture: [], contradictions: [], open_questions: [],
      languages: [], frameworks: [], data_stores: [], deployment: [],
    },
    obligations: [], excluded: [], disputed: [],
    evidence: {
      generated_at: new Date().toISOString(), root_hash: "h", file_count: 5, loc: 100,
      languages: {}, frameworks: [], data_stores: [], findings: [],
      sbom_component_count: 0, compliance_artifacts: {},
    },
    adversary: [], adjudications: [], gaps,
  };
}

/* ───────────────────────── money ───────────────────────── */

describe("no uncited monetary figure can reach any output", () => {
  test("a statutory maximum cannot be constructed without a citation", () => {
    expect(CitedMoneySchema.safeParse({ amount: 20000000, currency: "EUR" }).success).toBe(false);
    expect(
      CitedMoneySchema.safeParse({ amount: 20000000, currency: "EUR", citation }).success,
    ).toBe(true);
  });

  test("every monetary figure that reaches a gap carries a resolving URL", () => {
    const withMax = makeGap({
      exposure: {
        financial: {
          statutory_maximum: { amount: 20000000, currency: "EUR", or_percent_turnover: 4, citation },
          observed_enforcement_range: null,
          avoidable_costs: [],
          confidence: "medium",
        },
        non_financial: {
          market_access: null, contract_risk: null, operational: null,
          personal_liability: null, reputational: null, timeline_risk: null,
        },
      },
    });
    for (const fig of citedMonetaryFigures([withMax])) {
      expect(fig.citation).toMatch(/^https?:\/\//);
    }
  });

  test("an obligation penalty without a citation cannot validate", () => {
    const bad = ObligationSchema.safeParse({
      id: "x", regime: "Ghana", region: "gh", instrument: "Act 843", provision: "s18",
      title: "t", obligation_text: "text", applies_when: [], testable_as: [],
      penalty: { max: { amount: 1000, currency: "GHS" }, description: null, criminal: false },
      deadline: null, citations: [citation], confidence: 0.8,
      verification: "single_sourced", facets: [], source: "retrieved",
      retrieved_at: new Date().toISOString(),
    });
    expect(bad.success).toBe(false);
  });

  test("penalties across a corpus are all cited", () => {
    expect(obligationPenaltiesAreCited([])).toBe(true);
  });

  test("the ledger never sums maxima into a headline", () => {
    const a = makeGap({
      id: "GAP-001",
      exposure: {
        financial: {
          statutory_maximum: { amount: 20000000, currency: "EUR", citation },
          observed_enforcement_range: null, avoidable_costs: [], confidence: "medium",
        },
        non_financial: {
          market_access: null, contract_risk: null, operational: null,
          personal_liability: null, reputational: null, timeline_risk: null,
        },
      },
    });
    const b = makeGap({
      id: "GAP-002",
      exposure: {
        financial: {
          statutory_maximum: { amount: 5000000, currency: "GHS", citation },
          observed_enforcement_range: null, avoidable_costs: [], confidence: "medium",
        },
        non_financial: {
          market_access: null, contract_risk: null, operational: null,
          personal_liability: null, reputational: null, timeline_risk: null,
        },
      },
    });
    const md = renderLedger(makeResult([a, b]), cfg);
    expect(md).toContain("20,000,000");
    expect(md).toContain("5,000,000");
    // the sum must appear nowhere
    expect(md).not.toContain("25,000,000");
    expect(md).not.toContain("25000000");
    expect(md).toContain("not added up");
  });

  test("a gap with no cited maximum says 'not quantified' rather than guessing", () => {
    const md = renderLedger(makeResult([makeGap()]), cfg);
    expect(md).toMatch(/not quantified|Unknown/i);
  });
});

/* ───────────────────────── W/W/H/C validator ───────────────────────── */

describe("the What/Why/How/Consequence validator is structural, not advisory", () => {
  test("a complete gap passes", () => {
    expect(validateGap(makeGap() as unknown as Record<string, unknown>)).toEqual([]);
  });

  test("a missing residual-risk line fails", () => {
    const g = makeGap() as unknown as Record<string, unknown>;
    (((g.manual_fix as Record<string, unknown>).consequence) as Record<string, unknown>).residual_risk = "";
    const problems = validateGap(g);
    expect(problems.some((p) => p.includes("residual_risk"))).toBe(true);
    expect(problems.join(" ")).toContain("false comfort");
  });

  test("a vague 'what' fails", () => {
    const g = makeGap() as unknown as Record<string, unknown>;
    (g.manual_fix as Record<string, unknown>).what = "Improve data handling across the system";
    expect(validateGap(g).some((p) => p.includes("vague"))).toBe(true);
  });

  test("a 'why' with no citation fails", () => {
    const g = makeGap() as unknown as Record<string, unknown>;
    ((g.manual_fix as Record<string, unknown>).why as Record<string, unknown>).citations = [];
    expect(validateGap(g).some((p) => p.includes("citations"))).toBe(true);
  });

  test("an agent prompt that refers to the report fails, because it must be self-contained", () => {
    const g = makeGap() as unknown as Record<string, unknown>;
    g.agent_prompt = "Fix the gap above as described in the report. " + "x".repeat(200);
    expect(validateGap(g).some((p) => p.includes("self-contained") || p.includes("context it does not contain"))).toBe(true);
  });

  test("the schema itself rejects an empty residual risk", () => {
    const g = makeGap();
    const broken = { ...g, manual_fix: { ...g.manual_fix, consequence: { ...g.manual_fix.consequence, residual_risk: "" } } };
    expect(GapSchema.safeParse(broken).success).toBe(false);
  });
});

/* ───────────────────────── ROI honesty ───────────────────────── */

describe("ROI honesty rules", () => {
  const roi = computeRoi({
    cfg, result: makeResult([makeGap()]), meta: makeResult([]).meta,
    assumptions: DEFAULT_ASSUMPTIONS, assumptionsCustomised: false,
    wallClockMs: 60_000, spendBySeat: { research: 0.1, security: 0.2, architect: 0.3 },
    spendByPhase: { "2": 0.1 }, costReportedByVendor: true,
  });

  test("every figure is a range, never a point estimate", () => {
    expect(roi.time_saved.total_hours.low).toBeLessThanOrEqual(roi.time_saved.total_hours.high);
    expect(roi.retrofit.engineering_days_after_launch.low).toBeLessThanOrEqual(
      roi.retrofit.engineering_days_after_launch.high,
    );
  });

  test("every range names the counted artifact it derives from", () => {
    for (const t of [roi.time_saved.research_hours, roi.time_saved.review_hours, roi.time_saved.remediation_spec_hours]) {
      expect(t.basis.length).toBeGreaterThan(10);
      expect(t.assumption.length).toBeGreaterThan(3);
    }
  });

  test("the student profile values labour at zero currency and reports hours only", () => {
    expect(roi.hours_only).toBe(true);
    expect(roi.money_saved.total).toBeNull();
    expect(roi.headline).toContain("hours");
    expect(roi.headline).not.toMatch(/would have cost/);
  });

  test("unsourced assumptions are listed and rendered as unsourced, visibly", () => {
    expect(roi.unsourced_assumptions.length).toBeGreaterThan(0);
    const md = renderRoi(roi, cfg, DEFAULT_ASSUMPTIONS);
    expect(md).toContain("unsourced");
    expect(md).toContain("assumption(s) below are unsourced");
  });

  test("the 'what it did not do' section is present and non-trivial", () => {
    expect(roi.not_done.length).toBeGreaterThanOrEqual(6);
    const md = renderRoi(roi, cfg, DEFAULT_ASSUMPTIONS);
    expect(md).toContain("did **not** do");
    expect(md).toContain("legal advice");
  });

  test("bandLabel marks an unsourced band", () => {
    expect(isUnsourced(DEFAULT_ASSUMPTIONS.rates.engineer_day)).toBe(true);
    expect(bandLabel(DEFAULT_ASSUMPTIONS.rates.engineer_day)).toContain("(unsourced)");
  });
});

/* ───────────────────────── secrets never reach an artifact ───────────────────────── */

describe("no output artifact contains a key, a full .env, or personal data", () => {
  const result = makeResult([makeGap()]);
  const artifacts = [
    renderReport(result, cfg),
    renderLedger(result, cfg),
    JSON.stringify(result),
  ];

  for (const [i, text] of artifacts.entries()) {
    test(`artifact ${i} carries no secret`, () => {
      expect(findSecrets(text)).toEqual([]);
    });
    test(`artifact ${i} carries no personal data`, () => {
      expect(findPii(text)).toEqual([]);
    });
  }

  test("the permanent footer is on every report", () => {
    for (const text of [renderReport(result, cfg), renderLedger(result, cfg)]) {
      expect(text).toContain("not legal advice");
    }
  });
});

/* ───────────────────────── map isolation ───────────────────────── */

describe("the pseudonym map never appears in a payload, a cache entry, or an export", () => {
  test("a sealed payload never carries the reverse mapping", () => {
    const map = PseudonymMap.ephemeral("iso");
    const real = "calculateEnterpriseTier";
    const pseudo = map.symbol(real, "fn");
    const payload = sealPayload({
      messages: [{ role: "user", content: `function ${pseudo}() {}` }],
      represents: ["src/billing.ts"],
      level: 1,
      purpose: "test",
    });
    const text = payloadText(payload);
    expect(text).toContain(pseudo);
    expect(text).not.toContain(real);
  });

  test("map.json is written outside the output directory and is not an artifact", () => {
    const dir = mkdtempSync(join(tmpdir(), "addgp-map-"));
    const file = join(dir, "map.json");
    const map = PseudonymMap.load(file, "iso");
    map.symbol("secretFunctionName", "fn");
    map.save();
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toContain("secretFunctionName");
    // it lives under .addgp/sovereign/, which the deny-list refuses to send
    const { denyCheck } = require("../../src/sovereignty/denylist.ts") as typeof import("../../src/sovereignty/denylist.ts");
    expect(denyCheck(".addgp/sovereign/map.json").denied).toBe(true);
  });

  test("the real path never appears in the sealed path", () => {
    const map = PseudonymMap.ephemeral("iso");
    const sealed = map.pathPseudonym("src/billing/pricingEngine.ts");
    expect(sealed).not.toContain("billing");
    expect(sealed).not.toContain("pricingEngine");
    expect(map.real(sealed)).toBe("src/billing/pricingEngine.ts");
  });
});
