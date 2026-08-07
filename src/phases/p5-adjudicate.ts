import type { Config } from "../config/index.ts";
import type { Paths } from "../util/paths.ts";
import { log } from "../util/log.ts";
import { renderPrompt } from "../util/prompts.ts";
import type { Sovereignty } from "../sovereignty/index.ts";
import { extractJson, ProviderSkipped, type Providers } from "../providers/index.ts";
import { summariseEvidence } from "./p1-profile.ts";
import {
  AdjudicationSchema, GapSchema, severityRank,
  type Adjudication, type AdversaryFinding, type EvidenceBundle, type Exposure,
  type Gap, type Obligation, type ProjectProfile,
} from "../schemas/index.ts";

export interface AdjudicateOptions {
  cfg: Config;
  paths: Paths;
  sov: Sovereignty;
  providers: Providers;
  profile: ProjectProfile;
  evidence: EvidenceBundle;
  adversary: AdversaryFinding[];
  obligations: Obligation[];
}

export interface AdjudicateResult {
  adjudications: Adjudication[];
  gaps: Gap[];
  /** validator complaints that could not be repaired — reported, never hidden */
  validation_failures: { gap_id: string; problems: string[] }[];
}

const OBLIGATIONS_PER_CALL = 12;

/**
 * Phase 5 — merge law × evidence → gaps. The only stage that sees everything at
 * once, and the one §13 refuses to degrade: phase 5 is the product.
 */
export async function runAdjudicate(opts: AdjudicateOptions): Promise<AdjudicateResult> {
  const { cfg, sov, providers, profile, evidence, adversary, obligations } = opts;

  const adjudications: Adjudication[] = [];
  const evidenceSummary = summariseEvidence(evidence);
  const profileText = JSON.stringify(profile, null, 2);
  const adversaryText = adversary.length
    ? adversary
        .map(
          (a) =>
            `- ${a.id} [${a.severity}${a.status === "unconfirmed" ? ", UNCONFIRMED" : ""}] ${a.category}: ${a.title} @ ${a.location}\n  impact: ${a.impact}`,
        )
        .join("\n")
    : "(phase 4 produced no findings, or was skipped — treat security posture as unassessed rather than clean)";

  for (let i = 0; i < obligations.length; i += OBLIGATIONS_PER_CALL) {
    const chunk = obligations.slice(i, i + OBLIGATIONS_PER_CALL);
    const { system, user, version } = renderPrompt("05-adjudicate", {
      OBLIGATIONS: chunk.map(renderObligation).join("\n\n"),
      PROFILE: profileText,
      EVIDENCE: evidenceSummary,
      ADVERSARY: adversaryText,
    });

    const payload = sov.sealText(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      `phase 5: adjudicate ${i + 1}-${i + chunk.length}`,
    );

    const res = await providers.architect.call(payload, {
      phase: 5,
      promptVersion: version,
      purpose: `adjudicate:${i}`,
      maxTokens: 8000,
      ttlDays: cfg.cache.ttl_days.evidence,
    });

    const parsed = extractJson<unknown[]>(res.text);
    if (!Array.isArray(parsed)) {
      log.warn(`Adjudication batch ${i / OBLIGATIONS_PER_CALL + 1} returned no usable JSON; those obligations are marked indeterminate.`);
      adjudications.push(...chunk.map(indeterminate));
      continue;
    }

    const seen = new Set<string>();
    for (const raw of sov.rehydrate(parsed)) {
      const a = buildAdjudication(raw, chunk);
      if (!a) continue;
      seen.add(a.obligation_id);
      adjudications.push(a);
    }
    // An obligation the model silently dropped is indeterminate, never satisfied.
    for (const ob of chunk) {
      if (!seen.has(ob.id)) adjudications.push(indeterminate(ob));
    }
  }

  // Every partial and unsatisfied adjudication becomes a Gap.
  const gapSources = adjudications.filter((a) => a.status === "partial" || a.status === "unsatisfied");
  const gaps: Gap[] = [];
  const failures: { gap_id: string; problems: string[] }[] = [];
  let n = 0;

  for (const adj of gapSources) {
    const ob = obligations.find((o) => o.id === adj.obligation_id);
    if (!ob) continue;
    const id = `GAP-${String(++n).padStart(3, "0")}`;
    try {
      const { gap, problems } = await buildGap(opts, id, ob, adj, evidenceSummary, adversary);
      if (gap) {
        gaps.push(gap);
        if (problems.length) failures.push({ gap_id: id, problems });
      } else {
        failures.push({ gap_id: id, problems });
      }
    } catch (e) {
      if (e instanceof ProviderSkipped) {
        log.warn(`Gap generation stopped: ${e.reason}`);
        break;
      }
      throw e;
    }
  }

  return { adjudications, gaps: dedupeGaps(gaps), validation_failures: failures };
}

function renderObligation(ob: Obligation): string {
  return [
    `### ${ob.id}`,
    `Regime: ${ob.regime} (${ob.region})`,
    `Instrument: ${ob.instrument}`,
    `Provision: ${ob.provision}`,
    `Title: ${ob.title}`,
    `Requires: ${ob.obligation_text}`,
    ob.applies_when.length ? `Applies when: ${ob.applies_when.join("; ")}` : "",
    ob.testable_as.length ? `Testable as: ${ob.testable_as.join("; ")}` : "",
    ob.deadline ? `Deadline: ${ob.deadline}` : "",
    `Verification: ${ob.verification}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function indeterminate(ob: Obligation): Adjudication {
  return {
    obligation_id: ob.id,
    status: "indeterminate",
    rationale:
      "No adjudication was produced for this obligation. It is recorded as indeterminate rather than " +
      "satisfied, because absence of an answer is not evidence of compliance.",
    resolving_evidence:
      "Re-run phase 5, or provide the artifact this obligation asks for so the next run can decide it.",
    evidence: [],
    adversary_findings: [],
    confidence: 0,
  };
}

function buildAdjudication(raw: unknown, chunk: Obligation[]): Adjudication | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = String(r.obligation_id ?? "");
  if (!chunk.some((o) => o.id === id)) return null;

  const candidate = {
    obligation_id: id,
    status: r.status,
    rationale: String(r.rationale ?? ""),
    resolving_evidence: typeof r.resolving_evidence === "string" ? r.resolving_evidence : null,
    evidence: Array.isArray(r.evidence) ? r.evidence.map(String) : [],
    adversary_findings: Array.isArray(r.adversary_findings) ? r.adversary_findings.map(String) : [],
    confidence: typeof r.confidence === "number" ? Math.max(0, Math.min(1, r.confidence)) : 0.5,
  };
  const parsed = AdjudicationSchema.safeParse(candidate);
  if (!parsed.success) return null;

  // §6.5 — indeterminate is first-class and MUST state what would resolve it.
  if (parsed.data.status === "indeterminate" && !parsed.data.resolving_evidence) {
    parsed.data.resolving_evidence =
      "Not stated by the adjudicator. Treat this as: the artifact or contract this obligation asks for was " +
      "not found in the repository, and its existence elsewhere needs confirming.";
  }
  return parsed.data;
}

/* ───────────────────────── gap construction ───────────────────────── */

async function buildGap(
  opts: AdjudicateOptions,
  id: string,
  ob: Obligation,
  adj: Adjudication,
  evidenceSummary: string,
  adversary: AdversaryFinding[],
): Promise<{ gap: Gap | null; problems: string[] }> {
  const related = adversary.filter((a) => adj.adversary_findings.includes(a.id));

  const { system, user, version } = renderPrompt("05-gap", {
    OBLIGATION: renderObligation(ob) + `\nCitations: ${ob.citations.map((c) => c.url).join(", ")}`,
    ADJUDICATION: `Status: ${adj.status}\nRationale: ${adj.rationale}\nConfidence: ${adj.confidence}`,
    EVIDENCE: evidenceSummary,
    ADVERSARY: related.length
      ? related.map((a) => `- ${a.id} [${a.severity}] ${a.title}: ${a.impact}`).join("\n")
      : "(none linked)",
    PROFILE: opts.profile.summary,
  });

  const payload = opts.sov.sealText(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    `phase 5: gap ${id}`,
  );

  const res = await opts.providers.architect.call(payload, {
    phase: 5,
    promptVersion: version,
    purpose: `gap:${ob.id}`,
    maxTokens: 8000,
    ttlDays: opts.cfg.cache.ttl_days.evidence,
  });

  const parsed = extractJson<Record<string, unknown>>(res.text);
  if (!parsed) {
    return { gap: null, problems: ["the architect seat returned no usable JSON for this gap"] };
  }

  const rehydrated = opts.sov.rehydrate(parsed);
  const assembled = assembleGap(id, ob, adj, rehydrated, related, opts);
  const problems = validateGap(assembled);

  const parsedGap = GapSchema.safeParse(assembled);
  if (!parsedGap.success) {
    return {
      gap: null,
      problems: [
        ...problems,
        ...parsedGap.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      ],
    };
  }
  return { gap: parsedGap.data, problems };
}

function assembleGap(
  id: string,
  ob: Obligation,
  adj: Adjudication,
  raw: Record<string, unknown>,
  related: AdversaryFinding[],
  opts: AdjudicateOptions,
): Record<string, unknown> {
  const fix = (raw.manual_fix ?? {}) as Record<string, unknown>;
  const why = (fix.why ?? {}) as Record<string, unknown>;
  const consequence = (fix.consequence ?? {}) as Record<string, unknown>;
  const effort = (fix.effort ?? {}) as Record<string, unknown>;
  const rawExposure = (raw.exposure ?? {}) as Record<string, unknown>;
  const roi = (raw.roi_inputs ?? {}) as Record<string, unknown>;

  return {
    id,
    title: String(raw.title ?? ob.title),
    status: adj.status === "partial" ? "partial" : "unsatisfied",
    severity: normaliseSeverity(raw.severity, ob, related),
    severity_basis: Array.isArray(raw.severity_basis) && raw.severity_basis.length
      ? raw.severity_basis.map(String)
      : deriveSeverityBasis(ob, related),
    obligations: [ob.id],
    evidence: adj.evidence,
    adversary_findings: adj.adversary_findings,
    regions: [ob.region],
    confidence: typeof raw.confidence === "number" ? raw.confidence : adj.confidence,
    manual_fix: {
      what: String(fix.what ?? ""),
      why: {
        legal: String(why.legal ?? ""),
        engineering: String(why.engineering ?? ""),
        citations: Array.isArray(why.citations) && why.citations.length ? why.citations.map(String) : [ob.id],
        file_refs: Array.isArray(why.file_refs) ? why.file_refs.map(String) : [],
      },
      how: Array.isArray(fix.how) ? fix.how.map(String).filter((s) => s.length >= 5) : [],
      consequence: {
        if_unfixed: String(consequence.if_unfixed ?? ""),
        if_fixed: String(consequence.if_fixed ?? ""),
        residual_risk: String(consequence.residual_risk ?? ""),
      },
      effort: {
        engineering_days: typeof effort.engineering_days === "number" ? effort.engineering_days : 1,
        legal_review: effort.legal_review === true,
        vendor_action: effort.vendor_action === true,
      },
      verify: Array.isArray(fix.verify) && fix.verify.length
        ? fix.verify.map(String)
        : [`addgp-lite scan --phases 3,5 --filter ${id}`],
    },
    agent_prompt: String(raw.agent_prompt ?? ""),
    exposure: buildExposure(ob, rawExposure),
    roi_inputs: {
      remediation_spec_hours: typeof roi.remediation_spec_hours === "number" ? roi.remediation_spec_hours : 2,
      review_paths: typeof roi.review_paths === "number" ? roi.review_paths : adj.evidence.length || 1,
      pre_launch: roi.pre_launch !== false,
    },
    dependencies: Array.isArray(raw.dependencies) ? raw.dependencies.map(String) : [],
    owner_hint: String(raw.owner_hint ?? (opts.cfg.project.profile === "student" ? "you" : "backend")),
  };
}

/**
 * §7 — every monetary figure comes from the cited instrument. The model is never
 * permitted to supply one: statutory_maximum is copied from the obligation's own
 * cited penalty or is null. This is what makes milestone 11's property test pass.
 */
function buildExposure(ob: Obligation, raw: Record<string, unknown>): Exposure {
  const financial = (raw.financial ?? {}) as Record<string, unknown>;
  const nonFinancial = (raw.non_financial ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

  const avoidable = Array.isArray(financial.avoidable_costs)
    ? (financial.avoidable_costs as unknown[])
        .map((c) => {
          const o = (c ?? {}) as Record<string, unknown>;
          if (typeof o.item !== "string") return null;
          return {
            item: o.item,
            ...(typeof o.note === "string" ? { note: o.note } : {}),
            ...(typeof o.estimate_days === "number" ? { estimate_days: o.estimate_days } : {}),
          };
        })
        .filter((c): c is { item: string; note?: string; estimate_days?: number } => c !== null)
    : [];

  return {
    financial: {
      // Copied from the cited instrument, never from the model.
      statutory_maximum: ob.penalty?.max ?? null,
      // Only a cited, retrieved enforcement range may appear here; phase 2 does
      // not currently produce one, so it stays null rather than being invented.
      observed_enforcement_range: null,
      avoidable_costs: avoidable,
      confidence: ["low", "medium", "high"].includes(String(financial.confidence))
        ? (financial.confidence as "low" | "medium" | "high")
        : "low",
    },
    non_financial: {
      market_access: str(nonFinancial.market_access),
      contract_risk: str(nonFinancial.contract_risk),
      operational: str(nonFinancial.operational),
      personal_liability: str(nonFinancial.personal_liability),
      reputational: str(nonFinancial.reputational),
      timeline_risk: str(nonFinancial.timeline_risk),
    },
  };
}

function normaliseSeverity(raw: unknown, ob: Obligation, related: AdversaryFinding[]): string {
  const allowed = ["low", "medium", "high", "critical"];
  const given = String(raw ?? "").toLowerCase();
  if (allowed.includes(given)) return given;
  if (related.some((a) => a.severity === "critical")) return "critical";
  if (ob.penalty?.criminal) return "critical";
  if (ob.penalty?.max) return "high";
  return "medium";
}

function deriveSeverityBasis(ob: Obligation, related: AdversaryFinding[]): string[] {
  const basis: string[] = [];
  if (ob.penalty?.max) basis.push("max_penalty");
  if (ob.penalty?.criminal) basis.push("criminal_liability");
  if (ob.deadline) basis.push("statutory_deadline");
  if (related.length) basis.push("confirmed_adversary_finding");
  if (!basis.length) basis.push("obligation_unsatisfied");
  return basis;
}

/* ───────────────────────── structural validators ───────────────────────── */

const VAGUE = /^(?:improve|enhance|review|consider|ensure|make sure|better|address|handle|update|fix)\b/i;
const CONCRETE_HINT = /[./_]|\b(?:column|table|file|endpoint|header|policy|document|migration|env|config|flag|field|route|job|index)\b/i;

/**
 * §6.5 — What / Why / How / Consequence enforced by a structural validator, not
 * merely requested in a prompt. Milestone 10: a missing residual-risk line fails
 * the build.
 */
export function validateGap(gap: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const fix = (gap.manual_fix ?? {}) as Record<string, unknown>;
  const why = (fix.why ?? {}) as Record<string, unknown>;
  const consequence = (fix.consequence ?? {}) as Record<string, unknown>;

  const what = String(fix.what ?? "");
  if (what.length < 20) problems.push("manual_fix.what is missing or too short to name a change");
  else if (VAGUE.test(what) && !CONCRETE_HINT.test(what)) {
    problems.push(`manual_fix.what is vague ("${what.slice(0, 60)}…") — it must name a concrete change`);
  }

  const legal = String(why.legal ?? "");
  if (legal.length < 10) problems.push("manual_fix.why.legal is missing");
  const engineering = String(why.engineering ?? "");
  if (engineering.length < 10) problems.push("manual_fix.why.engineering is missing");
  if (!Array.isArray(why.citations) || why.citations.length === 0) {
    problems.push("manual_fix.why.citations is empty — every legal claim carries a resolving citation");
  }

  const how = Array.isArray(fix.how) ? fix.how : [];
  if (how.length === 0) problems.push("manual_fix.how has no steps");

  const residual = String(consequence.residual_risk ?? "");
  if (!residual.trim()) {
    problems.push(
      "manual_fix.consequence.residual_risk is empty — this line is what stops the report selling false comfort",
    );
  }
  if (String(consequence.if_unfixed ?? "").length < 20) problems.push("manual_fix.consequence.if_unfixed is missing");
  if (String(consequence.if_fixed ?? "").length < 10) problems.push("manual_fix.consequence.if_fixed is missing");

  const prompt = String(gap.agent_prompt ?? "");
  if (prompt.length < 200) problems.push("agent_prompt is too short to be self-contained");
  if (/\bthe (?:report|gap above|previous|earlier)\b/i.test(prompt)) {
    problems.push("agent_prompt refers to context it does not contain — it must assume no memory of the report");
  }

  return problems;
}

/** Two identical runs must produce the same gap set (milestone 9). */
function dedupeGaps(gaps: Gap[]): Gap[] {
  const byKey = new Map<string, Gap>();
  for (const g of gaps) {
    const key = `${g.obligations.join(",")}|${g.title.toLowerCase().slice(0, 80)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, g);
      continue;
    }
    existing.evidence = [...new Set([...existing.evidence, ...g.evidence])];
    existing.adversary_findings = [...new Set([...existing.adversary_findings, ...g.adversary_findings])];
    existing.regions = [...new Set([...existing.regions, ...g.regions])];
  }
  const out = [...byKey.values()].sort((a, b) => {
    const s = severityRank(a.severity) - severityRank(b.severity);
    return s !== 0 ? s : a.id.localeCompare(b.id);
  });
  // Renumber so ids are dense and stable in report order.
  return out.map((g, i) => ({ ...g, id: `GAP-${String(i + 1).padStart(3, "0")}` }));
}

/** Remediation order: dependencies first, then severity (§9 remediation plan). */
export function remediationOrder(gaps: Gap[]): Gap[] {
  const byId = new Map(gaps.map((g) => [g.id, g]));
  const visited = new Set<string>();
  const out: Gap[] = [];

  const visit = (g: Gap, stack: Set<string>) => {
    if (visited.has(g.id) || stack.has(g.id)) return;
    stack.add(g.id);
    for (const dep of g.dependencies) {
      const d = byId.get(dep);
      if (d) visit(d, stack);
    }
    stack.delete(g.id);
    visited.add(g.id);
    out.push(g);
  };

  for (const g of [...gaps].sort((a, b) => severityRank(a.severity) - severityRank(b.severity))) {
    visit(g, new Set());
  }
  return out;
}
