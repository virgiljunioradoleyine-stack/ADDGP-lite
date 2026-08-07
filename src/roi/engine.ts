import type { Config } from "../config/index.ts";
import type { Gap, Obligation, RunMeta, ScanResult } from "../schemas/index.ts";
import type { Band, Assumptions } from "./assumptions.ts";
import { isUnsourced } from "./assumptions.ts";

/**
 * §8 — what did this save me in time and money, versus the alternatives, and
 * versus doing nothing?
 *
 * The honesty rules are enforced here rather than in the prompt:
 *  - every figure is a RANGE, never a point estimate
 *  - every range names the assumption it came from
 *  - every figure traces to a COUNTED artifact from the run
 *  - a student profile reports hours only, never currency
 */

export interface Range {
  low: number;
  high: number;
}

export interface TracedRange extends Range {
  /** the counted artifact this derives from — "47 obligations retrieved" */
  basis: string;
  /** the assumption key that produced it */
  assumption: string;
  unsourced: boolean;
}

export interface RoiReport {
  generated_at: string;
  run_id: string;
  profile: "student" | "indie" | "company";
  currency: string;
  /** true when labour is reported in hours only */
  hours_only: boolean;
  assumptions_customised: boolean;

  counts: {
    obligations_retrieved: number;
    obligations_verified: number;
    regions: number;
    code_paths_reviewed: number;
    files_scanned: number;
    gaps: number;
    gaps_by_severity: Record<string, number>;
    adversary_findings: number;
    agent_prompts_generated: number;
  };

  spend: {
    total_usd: number;
    by_seat: Record<string, number>;
    by_phase: Record<string, number>;
    reported_by_vendor: boolean;
    /** the user's own time, measured not estimated */
    wall_clock_minutes: number;
  };

  time_saved: {
    research_hours: TracedRange;
    review_hours: TracedRange;
    remediation_spec_hours: TracedRange;
    total_hours: TracedRange;
  };

  money_saved: {
    /** null for the student profile — hours only */
    alternatives: AlternativeCost[];
    total: Range | null;
  };

  exposure: {
    gaps_with_cited_maximum: number;
    /** never a sum — §7 forbids stacking maxima into a headline */
    cited_maxima: { gap_id: string; amount: number; currency: string; citation: string }[];
    unquantified_gaps: number;
    qualitative_items: number;
  };

  retrofit: {
    pre_launch_gaps: number;
    engineering_days_now: Range;
    engineering_days_after_launch: TracedRange;
  };

  headline: string;
  not_done: string[];
  unsourced_assumptions: string[];
}

export interface AlternativeCost {
  name: string;
  produces: string;
  would_not_produce: string;
  cost: Range | null;
  cost_label: string;
  days: Range;
  cost_basis: string;
  time_basis: string;
  unsourced: boolean;
}

export interface RoiInputs {
  cfg: Config;
  result: ScanResult;
  meta: RunMeta;
  assumptions: Assumptions;
  assumptionsCustomised: boolean;
  /** measured wall-clock of the run plus the user's setup time */
  wallClockMs: number;
  userMinutes?: number;
  spendBySeat: Record<string, number>;
  spendByPhase: Record<string, number>;
  costReportedByVendor: boolean;
}

const bandRange = (b: Band): Range => ({ low: b.low, high: b.high });

function traced(count: number, per: Band, divisor: number, basis: string, key: string): TracedRange {
  return {
    low: (count * per.low) / divisor,
    high: (count * per.high) / divisor,
    basis,
    assumption: key,
    unsourced: isUnsourced(per),
  };
}

export function computeRoi(input: RoiInputs): RoiReport {
  const { cfg, result, meta, assumptions: a } = input;
  const isStudent = cfg.project.profile === "student";

  const obligations = result.obligations;
  const gaps = result.gaps;
  const codePaths = countReviewedPaths(result);

  const gapsBySeverity: Record<string, number> = {};
  for (const g of gaps) gapsBySeverity[g.severity] = (gapsBySeverity[g.severity] ?? 0) + 1;

  /* ---- 3. what it saved in time: derived from the run's own counts ---- */
  const research = traced(
    obligations.length,
    a.research_minutes_per_obligation,
    60,
    `${obligations.length} obligation(s) retrieved and verified`,
    "research_minutes_per_obligation",
  );
  const review = traced(
    codePaths,
    a.review_minutes_per_path,
    60,
    `${codePaths} code path(s) audited`,
    "review_minutes_per_path",
  );
  const spec = traced(
    gaps.length,
    a.hours_to_write_remediation_spec,
    1,
    `${gaps.length} gap(s), each with a written remediation and a self-contained agent prompt`,
    "hours_to_write_remediation_spec",
  );

  const totalHours: TracedRange = {
    low: research.low + review.low + spec.low,
    high: research.high + review.high + spec.high,
    basis: "sum of research, review and remediation-specification time",
    assumption: "research_minutes_per_obligation + review_minutes_per_path + hours_to_write_remediation_spec",
    unsourced: research.unsourced || review.unsourced || spec.unsourced,
  };

  /* ---- 2. what it replaced ---- */
  const dayRate = isStudent ? a.rates.student_engineer_day : a.rates.engineer_day;
  const alternatives = buildAlternatives(a, isStudent, totalHours, dayRate);

  const monetisable = alternatives.filter((alt) => alt.cost !== null);
  const totalMoney: Range | null =
    isStudent || !monetisable.length
      ? null
      : {
          low: Math.min(...monetisable.map((alt) => alt.cost!.low)),
          high: Math.max(...monetisable.map((alt) => alt.cost!.high)),
        };

  /* ---- 4. exposure, straight from the ledger, never summed ---- */
  const citedMaxima = gaps
    .filter((g) => g.exposure.financial.statutory_maximum !== null)
    .map((g) => ({
      gap_id: g.id,
      amount: g.exposure.financial.statutory_maximum!.amount,
      currency: g.exposure.financial.statutory_maximum!.currency,
      citation: g.exposure.financial.statutory_maximum!.citation.url,
    }));

  const qualitative = gaps.reduce(
    (n, g) => n + Object.values(g.exposure.non_financial).filter((v) => v !== null).length,
    0,
  );

  /* ---- retrofit multiplier ---- */
  const preLaunch = gaps.filter((g) => g.roi_inputs.pre_launch);
  const daysNow: Range = {
    low: gaps.reduce((n, g) => n + g.manual_fix.effort.engineering_days, 0),
    high: gaps.reduce((n, g) => n + g.manual_fix.effort.engineering_days, 0),
  };
  const retrofitAfter: TracedRange = {
    low: daysNow.low * a.retrofit_multiplier.low,
    high: daysNow.high * a.retrofit_multiplier.high,
    basis: `${gaps.length} gap(s) totalling ${daysNow.low} engineering day(s) if fixed now`,
    assumption: "retrofit_multiplier",
    unsourced: isUnsourced(a.retrofit_multiplier),
  };

  const unsourced = collectUnsourced(a);

  return {
    generated_at: meta.finished_at,
    run_id: meta.run_id,
    profile: cfg.project.profile,
    currency: dayRate.currency ?? "USD",
    hours_only: isStudent,
    assumptions_customised: input.assumptionsCustomised,

    counts: {
      obligations_retrieved: obligations.length,
      obligations_verified: obligations.filter((o) => o.verification === "double_sourced").length,
      regions: new Set(obligations.map((o) => o.region)).size,
      code_paths_reviewed: codePaths,
      files_scanned: result.evidence.file_count,
      gaps: gaps.length,
      gaps_by_severity: gapsBySeverity,
      adversary_findings: result.adversary.length,
      agent_prompts_generated: gaps.length,
    },

    spend: {
      total_usd: Object.values(input.spendBySeat).reduce((x, y) => x + y, 0),
      by_seat: input.spendBySeat,
      by_phase: input.spendByPhase,
      reported_by_vendor: input.costReportedByVendor,
      wall_clock_minutes: Math.round((input.wallClockMs / 60_000) * 10) / 10 + (input.userMinutes ?? 0),
    },

    time_saved: {
      research_hours: research,
      review_hours: review,
      remediation_spec_hours: spec,
      total_hours: totalHours,
    },

    money_saved: { alternatives, total: totalMoney },

    exposure: {
      gaps_with_cited_maximum: citedMaxima.length,
      cited_maxima: citedMaxima,
      unquantified_gaps: gaps.length - citedMaxima.length,
      qualitative_items: qualitative,
    },

    retrofit: {
      pre_launch_gaps: preLaunch.length,
      engineering_days_now: daysNow,
      engineering_days_after_launch: retrofitAfter,
    },

    headline: buildHeadline(isStudent, totalHours, totalMoney, dayRate.currency ?? "USD", input),
    not_done: NOT_DONE,
    unsourced_assumptions: unsourced,
  };
}

function countReviewedPaths(result: ScanResult): number {
  const files = new Set(result.evidence.findings.map((f) => f.file));
  files.delete("(repository)");
  return files.size;
}

function buildAlternatives(
  a: Assumptions,
  isStudent: boolean,
  hours: TracedRange,
  dayRate: Band,
): AlternativeCost[] {
  const hoursToDays = (h: Range): Range => ({ low: h.low / 8, high: h.high / 8 });
  const days = hoursToDays(hours);

  const money = (r: Range | null): Range | null => (isStudent ? null : r);
  const label = (r: Range | null, currency = "USD"): string =>
    r === null ? "not valued (student profile: hours only)" : `${currency} ${Math.round(r.low)}–${Math.round(r.high)}`;

  const counselCost: Range = {
    low: a.rates.privacy_counsel_hourly.low * hours.low,
    high: a.rates.privacy_counsel_hourly.high * hours.high,
  };
  const consultantCost: Range = {
    low: a.rates.compliance_consultant_day.low * a.alternatives_days.compliance_consultant.low,
    high: a.rates.compliance_consultant_day.high * a.alternatives_days.compliance_consultant.high,
  };
  const engineerCost: Range = {
    low: dayRate.low * a.alternatives_days.internal_engineer_manual.low,
    high: dayRate.high * a.alternatives_days.internal_engineer_manual.high,
  };
  const pentestCost = bandRange(a.rates.pentest_engagement);
  const grcCost = bandRange(a.rates.grc_saas_annual);

  return [
    {
      name: "External privacy counsel",
      produces: "Obligation mapping, DPIA, transfer analysis, and a legal opinion you can rely on",
      would_not_produce: "No code audit, no line-level findings, no agent prompts, and no re-run when the code changes",
      cost: money(counselCost),
      cost_label: label(money(counselCost), a.rates.privacy_counsel_hourly.currency),
      days: bandRange(a.alternatives_days.external_counsel),
      cost_basis: `hourly rate ${a.rates.privacy_counsel_hourly.low}–${a.rates.privacy_counsel_hourly.high} × the research hours this run replaced`,
      time_basis: "elapsed days including scheduling and turnaround",
      unsourced: isUnsourced(a.rates.privacy_counsel_hourly),
    },
    {
      name: "Compliance / GRC SaaS",
      produces: "Control checklists, policy templates, an evidence store",
      would_not_produce: "No jurisdiction-specific statutory text for the African regimes, and no analysis of your actual code",
      cost: money(grcCost),
      cost_label: label(money(grcCost), a.rates.grc_saas_annual.currency),
      days: bandRange(a.alternatives_days.grc_saas_onboarding),
      cost_basis: "annual subscription at the smallest tier",
      time_basis: "elapsed days to onboard and configure",
      unsourced: isUnsourced(a.rates.grc_saas_annual),
    },
    {
      name: "Penetration test engagement",
      produces: "Security findings, validated by hand, with an exploitation narrative",
      would_not_produce: "No legal mapping, no obligation citations, no compliance artifacts assessment",
      cost: money(pentestCost),
      cost_label: label(money(pentestCost), a.rates.pentest_engagement.currency),
      days: bandRange(a.alternatives_days.pentest_engagement),
      cost_basis: "fixed engagement fee for a small application",
      time_basis: "elapsed days including scheduling",
      unsourced: isUnsourced(a.rates.pentest_engagement),
    },
    {
      name: "Internal engineer, manual",
      produces: "Statute research plus a code audit, done by someone who already knows the codebase",
      would_not_produce: "Usually not finished: this is the option that gets started and abandoned",
      cost: money(engineerCost),
      cost_label: isStudent
        ? `${Math.round(days.low * 8)}–${Math.round(days.high * 8)} of your own hours`
        : label(money(engineerCost), dayRate.currency),
      days: bandRange(a.alternatives_days.internal_engineer_manual),
      cost_basis: isStudent
        ? "student profile: valued at zero currency, counted in hours"
        : `engineer day rate ${dayRate.low}–${dayRate.high} × elapsed days`,
      time_basis: "the biggest number on the page",
      unsourced: isUnsourced(dayRate),
    },
    {
      name: "Compliance consultant",
      produces: "A gap assessment report",
      would_not_produce: "No executable remediation steps and no agent prompts",
      cost: money(consultantCost),
      cost_label: label(money(consultantCost), a.rates.compliance_consultant_day.currency),
      days: bandRange(a.alternatives_days.compliance_consultant),
      cost_basis: `day rate ${a.rates.compliance_consultant_day.low}–${a.rates.compliance_consultant_day.high} × elapsed days`,
      time_basis: "elapsed weeks",
      unsourced: isUnsourced(a.rates.compliance_consultant_day),
    },
  ];
}

function buildHeadline(
  isStudent: boolean,
  hours: TracedRange,
  money: Range | null,
  currency: string,
  input: RoiInputs,
): string {
  const spend = Object.values(input.spendBySeat).reduce((x, y) => x + y, 0);
  const h = `${Math.round(hours.low)}–${Math.round(hours.high)} hours`;
  const assumptionSet = input.assumptionsCustomised ? "your edited assumptions" : "the shipped default assumptions";

  if (isStudent) {
    return (
      `This run cost $${spend.toFixed(2)} in API spend and replaced an estimated ${h} of manual work, ` +
      `under ${assumptionSet}. Labour is not valued in currency because the student profile is set.`
    );
  }
  if (!money) {
    return `This run cost $${spend.toFixed(2)} and replaced an estimated ${h} of manual work, under ${assumptionSet}.`;
  }
  return (
    `This run cost $${spend.toFixed(2)} in API spend and replaced ${h} of manual work — work that would have ` +
    `cost ${currency} ${Math.round(money.low)}–${Math.round(money.high)} through the alternatives below, ` +
    `under ${assumptionSet}.`
  );
}

function collectUnsourced(a: Assumptions): string[] {
  const out: string[] = [];
  const check = (key: string, b: Band) => {
    if (isUnsourced(b) && b.source !== "n/a") out.push(key);
  };
  for (const [k, v] of Object.entries(a.rates)) check(`rates.${k}`, v);
  check("research_minutes_per_obligation", a.research_minutes_per_obligation);
  check("review_minutes_per_path", a.review_minutes_per_path);
  check("hours_to_write_remediation_spec", a.hours_to_write_remediation_spec);
  check("retrofit_multiplier", a.retrofit_multiplier);
  for (const [k, v] of Object.entries(a.alternatives_days)) check(`alternatives_days.${k}`, v);
  return out;
}

/**
 * §8.3 item 7 — mandatory, and what makes the rest believable.
 */
export const NOT_DONE: string[] = [
  "It did not give you legal advice. Every obligation reported here needs review by a qualified practitioner in the relevant jurisdiction before you rely on it.",
  "It did not read your contracts. Whether your processor agreements contain the mandatory terms is a document question, and this tool only reads code.",
  "It did not verify that your privacy policy is accurate — only whether one exists. A policy that does not match your code is an enforceable misrepresentation in several of the regimes scanned.",
  "It did not assess your organisational measures: training, access reviews, vendor due diligence, or who is actually accountable.",
  "It did not run the stress harnesses it generated. They are written to disk for you to run against infrastructure you are authorised to test.",
  "It did not see your production configuration, your cloud console, or your database contents — only the code in this repository.",
  "It cannot tell you whether a regulator will agree with an interpretation. Where a provision has an interpretive edge, the report says so rather than picking a side.",
  "It did not check every dependency against a live vulnerability feed. The embedded advisory set is small and high-signal by design; run a live SCA tool as well.",
];

/** Property-test surface: no output artifact may contain an uncited monetary figure. */
export function citedMonetaryFigures(gaps: Gap[]): { gap: string; amount: number; citation: string }[] {
  const out: { gap: string; amount: number; citation: string }[] = [];
  for (const g of gaps) {
    const max = g.exposure.financial.statutory_maximum;
    if (max) out.push({ gap: g.id, amount: max.amount, citation: max.citation.url });
    const range = g.exposure.financial.observed_enforcement_range;
    if (range) {
      out.push({ gap: g.id, amount: range.low, citation: range.citations[0]?.url ?? "" });
      out.push({ gap: g.id, amount: range.high, citation: range.citations[0]?.url ?? "" });
    }
  }
  return out;
}

export function obligationPenaltiesAreCited(obligations: Obligation[]): boolean {
  return obligations.every((o) => !o.penalty?.max || !!o.penalty.max.citation?.url);
}
