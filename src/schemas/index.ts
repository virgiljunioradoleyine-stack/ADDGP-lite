import { z } from "zod";

/* ────────────────────────────── citations ────────────────────────────── */

export const CitationSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  publisher: z.string().optional(),
  /** true only when the host is on the region pack's authority allowlist */
  primary: z.boolean(),
  retrieved_at: z.string(),
  quote: z.string().optional(),
  /** set by the quote-fidelity check in phase 2 */
  quote_verified: z.boolean().optional(),
});
export type Citation = z.infer<typeof CitationSchema>;

/* ────────────────────────────── money ────────────────────────────── */

/**
 * There is no way to construct a monetary figure without a citation.
 * §7 and milestone 11 depend on this being impossible at the type level.
 */
export const CitedMoneySchema = z.object({
  amount: z.number().nonnegative(),
  currency: z.string().length(3),
  or_percent_turnover: z.number().optional(),
  citation: CitationSchema,
});
export type CitedMoney = z.infer<typeof CitedMoneySchema>;

export const EnforcementRangeSchema = z.object({
  low: z.number().nonnegative(),
  high: z.number().nonnegative(),
  currency: z.string().length(3),
  basis: z.string(),
  citations: z.array(CitationSchema).min(1),
});
export type EnforcementRange = z.infer<typeof EnforcementRangeSchema>;

/* ────────────────────────────── profile ────────────────────────────── */

export const DataCategorySchema = z.object({
  name: z.string(),
  special: z.boolean(),
  basis: z.string().optional(),
  evidence: z.array(z.string()).default([]),
});

export const ProjectProfileSchema = z.object({
  summary: z.string(),
  roles: z.array(z.enum(["controller", "processor", "joint_controller", "unclear"])),
  data_subjects: z.array(z.string()),
  data_categories: z.array(DataCategorySchema),
  processing_purposes: z.array(z.string()),
  automated_decisions: z.array(
    z.object({
      description: z.string(),
      legal_effect: z.boolean(),
      evidence: z.array(z.string()).default([]),
    }),
  ),
  ai_components: z.array(
    z.object({
      description: z.string(),
      vendor: z.string().optional(),
      role: z.enum(["provider", "deployer", "unclear"]).default("unclear"),
      evidence: z.array(z.string()).default([]),
    }),
  ),
  cross_border_flows: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      mechanism: z.string().nullable(),
      evidence: z.array(z.string()).default([]),
    }),
  ),
  third_parties: z.array(
    z.object({ name: z.string(), purpose: z.string(), dpa_known: z.boolean().default(false) }),
  ),
  security_posture: z.array(z.string()),
  contradictions: z.array(
    z.object({
      id: z.string(),
      claim: z.string(),
      evidence: z.string(),
      severity: z.enum(["blocking", "warning"]),
      question: z.string(),
    }),
  ),
  open_questions: z.array(
    z.object({ id: z.string(), question: z.string(), why_it_matters: z.string() }),
  ),
  languages: z.array(z.string()).default([]),
  frameworks: z.array(z.string()).default([]),
  data_stores: z.array(z.string()).default([]),
  deployment: z.array(z.string()).default([]),
});
export type ProjectProfile = z.infer<typeof ProjectProfileSchema>;

/* ────────────────────────────── obligations ────────────────────────────── */

export const ObligationSchema = z.object({
  id: z.string(),
  regime: z.string(),
  region: z.string(),
  instrument: z.string(),
  provision: z.string(),
  title: z.string(),
  obligation_text: z.string(),
  applies_when: z.array(z.string()).default([]),
  testable_as: z.array(z.string()).default([]),
  penalty: z
    .object({
      max: CitedMoneySchema.nullable(),
      description: z.string().nullable(),
      criminal: z.boolean().default(false),
    })
    .nullable(),
  deadline: z.string().nullable().default(null),
  citations: z.array(CitationSchema).min(1),
  confidence: z.number().min(0).max(1),
  verification: z.enum(["double_sourced", "single_sourced", "disputed", "quarantined", "pack_seed"]),
  facets: z.array(z.string()).default([]),
  source: z.enum(["pack", "retrieved"]),
  retrieved_at: z.string(),
});
export type Obligation = z.infer<typeof ObligationSchema>;

export const ExcludedObligationSchema = z.object({
  id: z.string(),
  title: z.string(),
  regime: z.string(),
  reason: z.string(),
  reason_code: z.enum([
    "region_not_selected",
    "applies_when_unmet",
    "no_primary_source",
    "disputed",
    "fabrication_suspected",
    "sector_not_applicable",
  ]),
});
export type ExcludedObligation = z.infer<typeof ExcludedObligationSchema>;

/* ────────────────────────────── evidence ────────────────────────────── */

export const EvidenceFindingSchema = z.object({
  id: z.string(),
  rule_id: z.string(),
  kind: z.enum([
    "pii_symbol", "secret", "dependency_vuln", "iac_misconfig", "artifact_present",
    "artifact_absent", "license", "data_flow", "ai_call_site", "auth", "logging",
    "retention", "crossborder", "storage",
  ]),
  title: z.string(),
  file: z.string(),
  line: z.number().int().nonnegative(),
  snippet_hash: z.string(),
  severity: z.enum(["info", "low", "medium", "high", "critical"]),
  /** The conclusion sent onward. Never the quotation. This is the §5.6 trick. */
  conclusion: z.string(),
  meta: z.record(z.unknown()).default({}),
});
export type EvidenceFinding = z.infer<typeof EvidenceFindingSchema>;

export const EvidenceBundleSchema = z.object({
  generated_at: z.string(),
  root_hash: z.string(),
  file_count: z.number(),
  loc: z.number(),
  languages: z.record(z.number()),
  frameworks: z.array(z.string()),
  data_stores: z.array(z.string()),
  findings: z.array(EvidenceFindingSchema),
  sbom_component_count: z.number(),
  compliance_artifacts: z.record(z.boolean()),
});
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;

/* ────────────────────────────── adversary ────────────────────────────── */

export const AdversaryFindingSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.enum([
    "authn", "authz", "injection", "deserialization", "ssrf", "idor", "race",
    "crypto", "tenant_isolation", "rls", "ai_prompt_injection", "ai_tool_abuse",
    "ai_output_handling", "ai_data_leakage", "ai_dos", "privacy_reidentification",
    "privacy_overcollection", "privacy_retention", "resilience", "supply_chain",
  ]),
  severity: z.enum(["info", "low", "medium", "high", "critical"]),
  owasp_llm: z.string().nullable().default(null),
  cwe: z.string().nullable().default(null),
  location: z.string(),
  condition: z.string(),
  impact: z.string(),
  confirmation_steps: z.array(z.string()),
  /** downgraded when phase 4 has no phase-3 anchor (§6.4 reconciliation) */
  status: z.enum(["confirmed", "unconfirmed"]).default("unconfirmed"),
  evidence_anchors: z.array(z.string()).default([]),
});
export type AdversaryFinding = z.infer<typeof AdversaryFindingSchema>;

/* ────────────────────────────── gaps ────────────────────────────── */

export const ConsequenceSchema = z.object({
  if_unfixed: z.string().min(20),
  if_fixed: z.string().min(10),
  /** The line that stops the report selling false comfort. Mandatory. */
  residual_risk: z.string().min(10),
});

export const ManualFixSchema = z.object({
  what: z.string().min(20),
  why: z.object({
    legal: z.string().min(10),
    engineering: z.string().min(10),
    citations: z.array(z.string()).min(1),
    file_refs: z.array(z.string()).default([]),
  }),
  how: z.array(z.string().min(5)).min(1),
  consequence: ConsequenceSchema,
  effort: z.object({
    engineering_days: z.number().nonnegative(),
    legal_review: z.boolean(),
    vendor_action: z.boolean(),
  }),
  verify: z.array(z.string()).min(1),
});
export type ManualFix = z.infer<typeof ManualFixSchema>;

export const ExposureSchema = z.object({
  financial: z.object({
    statutory_maximum: CitedMoneySchema.nullable(),
    observed_enforcement_range: EnforcementRangeSchema.nullable(),
    avoidable_costs: z.array(
      z.object({
        item: z.string(),
        note: z.string().optional(),
        estimate_days: z.number().optional(),
      }),
    ),
    confidence: z.enum(["low", "medium", "high"]),
  }),
  non_financial: z.object({
    market_access: z.string().nullable(),
    contract_risk: z.string().nullable(),
    operational: z.string().nullable(),
    personal_liability: z.string().nullable(),
    reputational: z.string().nullable(),
    timeline_risk: z.string().nullable(),
  }),
});
export type Exposure = z.infer<typeof ExposureSchema>;

export const GapSchema = z.object({
  id: z.string().regex(/^GAP-\d{3,}$/),
  title: z.string().min(10),
  status: z.enum(["partial", "unsatisfied"]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  severity_basis: z.array(z.string()).min(1),
  obligations: z.array(z.string()).min(1),
  evidence: z.array(z.string()).default([]),
  adversary_findings: z.array(z.string()).default([]),
  regions: z.array(z.string()).min(1),
  confidence: z.number().min(0).max(1),
  manual_fix: ManualFixSchema,
  agent_prompt: z.string().min(200),
  exposure: ExposureSchema,
  roi_inputs: z.object({
    remediation_spec_hours: z.number().nonnegative(),
    review_paths: z.number().nonnegative(),
    pre_launch: z.boolean(),
  }),
  dependencies: z.array(z.string()).default([]),
  owner_hint: z.string(),
});
export type Gap = z.infer<typeof GapSchema>;

export const AdjudicationSchema = z.object({
  obligation_id: z.string(),
  status: z.enum(["satisfied", "partial", "unsatisfied", "indeterminate"]),
  rationale: z.string(),
  /** mandatory when indeterminate — what evidence would resolve it */
  resolving_evidence: z.string().nullable().default(null),
  evidence: z.array(z.string()).default([]),
  adversary_findings: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
});
export type Adjudication = z.infer<typeof AdjudicationSchema>;

/* ────────────────────────────── run metadata ────────────────────────────── */

export const RunMetaSchema = z.object({
  run_id: z.string(),
  tool_version: z.string(),
  started_at: z.string(),
  finished_at: z.string(),
  duration_ms: z.number(),
  sovereignty_level: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  regions: z.array(z.string()),
  models: z.record(z.object({ provider: z.string(), id: z.string() })),
  phases_run: z.array(z.number()),
  phases_skipped: z.array(z.object({ phase: z.number(), reason: z.string() })),
  cost_usd: z.record(z.number()),
  prompt_hashes: z.record(z.string()),
  input_hash: z.string(),
  offline: z.boolean(),
  corpus_stale: z.boolean(),
  incomplete: z.boolean(),
  git_head: z.string().nullable(),
});
export type RunMeta = z.infer<typeof RunMetaSchema>;

export const ScanResultSchema = z.object({
  meta: RunMetaSchema,
  profile: ProjectProfileSchema,
  obligations: z.array(ObligationSchema),
  excluded: z.array(ExcludedObligationSchema),
  disputed: z.array(ObligationSchema),
  evidence: EvidenceBundleSchema,
  adversary: z.array(AdversaryFindingSchema),
  adjudications: z.array(AdjudicationSchema),
  gaps: z.array(GapSchema),
});
export type ScanResult = z.infer<typeof ScanResultSchema>;

export const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"] as const;
export type Severity = (typeof SEVERITY_ORDER)[number];

export function severityRank(s: string): number {
  const i = SEVERITY_ORDER.indexOf(s as Severity);
  return i === -1 ? 99 : i;
}
