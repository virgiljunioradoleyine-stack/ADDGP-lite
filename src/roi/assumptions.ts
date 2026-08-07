import { existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { readText } from "../util/fswalk.ts";
import { writeOut } from "../util/paths.ts";
import { log } from "../util/log.ts";

/**
 * §8.2 — every rate, band and multiplier lives here, shipped with sourced
 * defaults and a citation per line, fully editable.
 *
 * An assumption with no source renders as `unsourced` in the report. Visibly.
 */
export const BandSchema = z.object({
  low: z.number().nonnegative(),
  high: z.number().nonnegative(),
  currency: z.string().optional(),
  source: z.string().optional(),
  note: z.string().optional(),
});
export type Band = z.infer<typeof BandSchema>;

export const AssumptionsSchema = z.object({
  rates: z.object({
    privacy_counsel_hourly: BandSchema,
    engineer_day: BandSchema,
    student_engineer_day: BandSchema,
    compliance_consultant_day: BandSchema,
    pentest_engagement: BandSchema,
    grc_saas_annual: BandSchema,
  }),
  research_minutes_per_obligation: BandSchema,
  review_minutes_per_path: BandSchema,
  hours_to_write_remediation_spec: BandSchema,
  retrofit_multiplier: BandSchema,
  alternatives_days: z.object({
    external_counsel: BandSchema,
    grc_saas_onboarding: BandSchema,
    pentest_engagement: BandSchema,
    internal_engineer_manual: BandSchema,
    compliance_consultant: BandSchema,
  }),
});
export type Assumptions = z.infer<typeof AssumptionsSchema>;

/**
 * Defaults. Every band is wide because the true figure varies enormously by
 * jurisdiction and seniority — a narrow band here would be a more precise lie.
 */
export const DEFAULT_ASSUMPTIONS: Assumptions = {
  rates: {
    privacy_counsel_hourly: {
      low: 150, high: 600, currency: "USD",
      source: "unsourced",
      note: "Varies enormously by jurisdiction. A Accra or Lagos firm and a London firm are not the same number. Replace this with a quote you have actually received.",
    },
    engineer_day: {
      low: 200, high: 900, currency: "USD",
      source: "unsourced",
      note: "Fully-loaded cost of one engineer-day. Set this to your own rate — it drives most of the report.",
    },
    student_engineer_day: {
      low: 0, high: 0, currency: "USD",
      source: "n/a",
      note: "Default for the student profile: labour is valued at zero currency and reported purely in hours. A student's ROI is time and learning, and pretending otherwise is dishonest.",
    },
    compliance_consultant_day: {
      low: 400, high: 2000, currency: "USD",
      source: "unsourced",
      note: "Day rate for an independent compliance consultant.",
    },
    pentest_engagement: {
      low: 3000, high: 30000, currency: "USD",
      source: "unsourced",
      note: "Fixed fee for a scoped penetration test of a small application.",
    },
    grc_saas_annual: {
      low: 5000, high: 50000, currency: "USD",
      source: "unsourced",
      note: "Annual subscription for a compliance/GRC platform at the smallest tier.",
    },
  },
  research_minutes_per_obligation: {
    low: 20, high: 90,
    source: "unsourced",
    note: "Time for a competent non-specialist to locate a provision, read it, confirm it is in force, and write down what it requires.",
  },
  review_minutes_per_path: {
    low: 5, high: 20,
    source: "unsourced",
    note: "Time to manually review one code path for one compliance question.",
  },
  hours_to_write_remediation_spec: {
    low: 1, high: 4,
    source: "unsourced",
    note: "Time to write a remediation specification a developer could act on, by hand, per gap.",
  },
  retrofit_multiplier: {
    low: 3, high: 10,
    source: "unsourced",
    note: "Cost to fix a data-architecture problem after launch versus before. The wide band reflects how much this depends on whether data has already been collected under the wrong basis.",
  },
  alternatives_days: {
    external_counsel: { low: 5, high: 20, source: "unsourced", note: "Elapsed days for an obligation mapping and transfer analysis." },
    grc_saas_onboarding: { low: 2, high: 10, source: "unsourced", note: "Elapsed days to onboard and configure." },
    pentest_engagement: { low: 7, high: 21, source: "unsourced", note: "Elapsed days including scheduling." },
    internal_engineer_manual: { low: 10, high: 40, source: "unsourced", note: "Elapsed days for an engineer to research the statutes and audit the code themselves." },
    compliance_consultant: { low: 10, high: 30, source: "unsourced", note: "Elapsed days for a gap assessment." },
  },
};

export function loadAssumptions(file: string): { assumptions: Assumptions; customised: boolean } {
  if (!existsSync(file)) return { assumptions: DEFAULT_ASSUMPTIONS, customised: false };
  try {
    const raw = parseYaml(readText(file, ".yaml") ?? "");
    const parsed = AssumptionsSchema.safeParse(raw);
    if (!parsed.success) {
      log.warn(
        `roi.assumptions.yaml could not be parsed (${parsed.error.issues[0]?.message ?? "unknown"}); using shipped defaults.`,
      );
      return { assumptions: DEFAULT_ASSUMPTIONS, customised: false };
    }
    return { assumptions: parsed.data, customised: true };
  } catch (e) {
    log.warn(`roi.assumptions.yaml is not valid YAML (${(e as Error).message}); using shipped defaults.`);
    return { assumptions: DEFAULT_ASSUMPTIONS, customised: false };
  }
}

export function writeAssumptions(file: string): void {
  const header = `# Every figure here is an assumption. Edit it. Re-run \`addgp-lite roi\`.
#
# A band with source "unsourced" is printed as unsourced in ROI.md, visibly, so
# nobody mistakes a plausible default for a researched figure. Replace the ones
# that matter to you — the engineer_day rate drives most of the report.
#
# If project.profile is "student", labour is valued at zero currency and the
# report gives hours only.

`;
  writeOut(file, header + toYaml(DEFAULT_ASSUMPTIONS));
}

function toYaml(a: Assumptions): string {
  const band = (b: Band, indent: string): string => {
    const parts = [`low: ${b.low}`, `high: ${b.high}`];
    if (b.currency) parts.push(`currency: ${b.currency}`);
    parts.push(`source: ${JSON.stringify(b.source ?? "unsourced")}`);
    if (b.note) parts.push(`note: ${JSON.stringify(b.note)}`);
    return `${indent}{ ${parts.join(", ")} }`;
  };
  const lines: string[] = ["rates:"];
  for (const [k, v] of Object.entries(a.rates)) lines.push(`  ${k}:${band(v, " ")}`);
  lines.push(`research_minutes_per_obligation:${band(a.research_minutes_per_obligation, " ")}`);
  lines.push(`review_minutes_per_path:${band(a.review_minutes_per_path, " ")}`);
  lines.push(`hours_to_write_remediation_spec:${band(a.hours_to_write_remediation_spec, " ")}`);
  lines.push(`retrofit_multiplier:${band(a.retrofit_multiplier, " ")}`);
  lines.push("alternatives_days:");
  for (const [k, v] of Object.entries(a.alternatives_days)) lines.push(`  ${k}:${band(v, " ")}`);
  return lines.join("\n") + "\n";
}

export function isUnsourced(b: Band): boolean {
  return !b.source || b.source === "unsourced";
}

/** Render a band for display, marking unsourced ones visibly (§8.2). */
export function bandLabel(b: Band, unit = ""): string {
  const cur = b.currency ? `${b.currency} ` : "";
  const range = b.low === b.high ? `${cur}${b.low}${unit}` : `${cur}${b.low}–${b.high}${unit}`;
  return isUnsourced(b) ? `${range} (unsourced)` : range;
}
