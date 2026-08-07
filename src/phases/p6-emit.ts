import { join } from "node:path";
import { BRAND } from "../brand.ts";
import type { Config } from "../config/index.ts";
import { readJsonl, writeJson, writeOut, type Paths } from "../util/paths.ts";
import { log } from "../util/log.ts";
import type { EgressRecord } from "../sovereignty/gate.ts";
import type { Sovereignty, PreviewEntry } from "../sovereignty/index.ts";
import type { ScanResult } from "../schemas/index.ts";
import { componentsOf, toCycloneDx } from "./p3-evidence.ts";
import { writeHarnesses, type StressHarness } from "./p4-adversary.ts";
import { remediationOrder } from "./p5-adjudicate.ts";
import { computeRoi, type RoiReport } from "../roi/engine.ts";
import { loadAssumptions, writeAssumptions } from "../roi/assumptions.ts";
import {
  renderReport, renderExecutiveSummary, renderLedger, renderRoi, renderCitations,
  renderSovereignty, renderExcluded, renderAdversaryOnly,
} from "../render/markdown.ts";
import { renderSarif } from "../render/sarif.ts";
import { renderHtml } from "../render/html.ts";
import { renderPdf } from "../render/pdf.ts";
import { existsSync, writeFileSync } from "node:fs";

export interface EmitOptions {
  cfg: Config;
  paths: Paths;
  sov: Sovereignty;
  result: ScanResult;
  harnesses?: StressHarness[];
  wallClockMs: number;
  spendBySeat: Record<string, number>;
  spendByPhase: Record<string, number>;
  costReportedByVendor: boolean;
  formats?: string[];
  /** validation failures from phase 5, surfaced rather than hidden */
  validationFailures?: { gap_id: string; problems: string[] }[];
}

export interface EmitResult {
  files: string[];
  roi: RoiReport;
}

/**
 * Phase 6 — emit. Everything here is local and free: it re-renders from the
 * cached result, which is what makes `report --format` cheap and `--offline`
 * useful.
 */
export function runEmit(opts: EmitOptions): EmitResult {
  const { cfg, paths, sov, result } = opts;
  const files: string[] = [];
  const formats = new Set(opts.formats ?? ["md", "json", "sarif"]);
  const write = (file: string, content: string) => {
    writeOut(file, content);
    files.push(file);
  };

  /* ---- roi.assumptions.yaml: shipped on first run, never overwritten ---- */
  if (!existsSync(paths.assumptions)) writeAssumptions(paths.assumptions);
  const { assumptions, customised } = loadAssumptions(paths.assumptions);
  files.push(paths.assumptions);

  const roi = computeRoi({
    cfg,
    result,
    meta: result.meta,
    assumptions,
    assumptionsCustomised: customised,
    wallClockMs: opts.wallClockMs,
    spendBySeat: opts.spendBySeat,
    spendByPhase: opts.spendByPhase,
    costReportedByVendor: opts.costReportedByVendor,
  });

  /* ---- structured artifacts ---- */
  const jsonFiles: [string, unknown][] = [
    ["gaps.json", result.gaps],
    ["obligations.json", result.obligations],
    ["obligations.excluded.json", result.excluded],
    ["obligations.disputed.json", result.disputed],
    ["evidence.json", result.evidence],
    ["adversary.json", result.adversary],
    ["adjudications.json", result.adjudications],
    ["profile.json", result.profile],
    ["roi.json", roi],
    ["run.meta.json", result.meta],
  ];
  for (const [name, value] of jsonFiles) {
    const file = join(paths.out, name);
    writeJson(file, value);
    files.push(file);
  }

  /* ---- SBOM ---- */
  const components = componentsOf(paths.root);
  const sbomFile = join(paths.out, "sbom.cdx.json");
  writeJson(sbomFile, toCycloneDx(result.evidence, components, cfg.project.name));
  files.push(sbomFile);

  /* ---- SARIF ---- */
  if (formats.has("sarif") || formats.has("json")) {
    const sarifFile = join(paths.out, "findings.sarif");
    writeJson(sarifFile, renderSarif(result, paths.root));
    files.push(sarifFile);
  }

  /* ---- markdown ---- */
  const reportMd = renderReport(result, cfg);
  const summaryMd = renderExecutiveSummary(result, cfg, roi);
  const ledgerMd = renderLedger(result, cfg);
  const roiMd = renderRoi(roi, cfg, assumptions);
  const citationsMd = renderCitations(result.obligations);
  const excludedMd = renderExcluded(result.excluded);

  write(join(paths.out, "REPORT.md"), reportMd);
  write(join(paths.out, "EXECUTIVE_SUMMARY.md"), summaryMd);
  write(join(paths.out, "LEDGER.md"), ledgerMd);
  write(join(paths.out, "ROI.md"), roiMd);
  write(join(paths.out, "citations.md"), citationsMd);
  write(join(paths.out, "OBLIGATIONS_EXCLUDED.md"), excludedMd);
  if (result.adversary.length) {
    write(join(paths.out, "SECURITY_FINDINGS.md"), renderAdversaryOnly(result.adversary));
  }

  /* ---- SOVEREIGNTY.md ---- */
  const egress = readJsonl<EgressRecord>(paths.egress).filter((e) => e.run_id === result.meta.run_id);
  const preview: PreviewEntry[] = sov.preview(0);
  write(
    join(paths.out, "SOVEREIGNTY.md"),
    renderSovereignty(preview, egress, result.meta.sovereignty_level, sov.map.size),
  );

  /* ---- agent prompts ---- */
  const ordered = remediationOrder(result.gaps);
  for (const g of result.gaps) {
    write(join(paths.outPrompts, `${g.id}.md`), renderGapPrompt(g.id, g.title, g.agent_prompt));
  }
  write(join(paths.outPrompts, "00-MASTER.md"), renderMasterPrompt(ordered, cfg));

  /* ---- stress harnesses (written, never executed) ---- */
  if (opts.harnesses?.length) {
    files.push(...writeHarnesses(paths, opts.harnesses));
  }

  /* ---- validation failures, surfaced ---- */
  if (opts.validationFailures?.length) {
    const lines = [
      `# Gap validator complaints`,
      ``,
      `The structural validator rejected or flagged the following. They are recorded here rather than`,
      `hidden, because a gap that failed validation is a gap you should look at more carefully, not less.`,
      ``,
    ];
    for (const f of opts.validationFailures) {
      lines.push(`## ${f.gap_id}`);
      lines.push("");
      for (const p of f.problems) lines.push(`- ${p}`);
      lines.push("");
    }
    write(join(paths.out, "VALIDATION.md"), lines.join("\n"));
  }

  /* ---- html and pdf ---- */
  if (formats.has("html")) {
    for (const [name, md] of [
      ["REPORT", reportMd],
      ["EXECUTIVE_SUMMARY", summaryMd],
      ["LEDGER", ledgerMd],
      ["ROI", roiMd],
    ] as const) {
      write(join(paths.out, `${name}.html`), renderHtml(md, `${name.replace(/_/g, " ")} — ${cfg.project.name}`));
    }
  }
  if (formats.has("pdf")) {
    for (const [name, md] of [
      ["REPORT", reportMd],
      ["ROI", roiMd],
    ] as const) {
      const file = join(paths.out, `${name}.pdf`);
      writeFileSync(file, renderPdf(md, `${name} — ${cfg.project.name}`));
      files.push(file);
    }
  }

  log.ok(`Wrote ${files.length} artifact(s) to ${paths.out}/`);
  return { files, roi };
}

/* ───────────────────────── prompt files ───────────────────────── */

function renderGapPrompt(id: string, title: string, prompt: string): string {
  return (
    `# ${id} — ${title}\n\n` +
    `Paste everything below into any coding agent. It is self-contained: it assumes no memory of the report.\n\n` +
    `---\n\n` +
    prompt.trim() +
    `\n\n---\n\n` +
    `_${BRAND.disclaimerShort}_\n`
  );
}

/**
 * §6.5 — all gaps in dependency order, batched into sensible commits.
 */
function renderMasterPrompt(gaps: ReturnType<typeof remediationOrder>, cfg: Config): string {
  const out: string[] = [];
  out.push(`# Master remediation prompt — ${cfg.project.name}`);
  out.push("");
  out.push(
    `${gaps.length} gap(s), in dependency order, batched into commits. Work through them in this order: ` +
      `later batches assume earlier ones landed.`,
  );
  out.push("");
  out.push(
    `Each gap below is self-contained. If you are driving an agent, give it one batch at a time rather than ` +
      `the whole file — an agent asked to do twelve things at once does eleven of them badly.`,
  );
  out.push("");

  const batches = batchGaps(gaps);
  for (const [i, batch] of batches.entries()) {
    out.push(`## Commit ${i + 1}: ${batch.label}`);
    out.push("");
    for (const g of batch.gaps) {
      out.push(`### ${g.id} — ${g.title}`);
      out.push("");
      out.push(`**Severity:** ${g.severity} · **Effort:** ${g.manual_fix.effort.engineering_days} day(s)` +
        `${g.manual_fix.effort.legal_review ? " · needs legal review" : ""}` +
        `${g.manual_fix.effort.vendor_action ? " · needs vendor action" : ""}`);
      out.push("");
      out.push("````text");
      out.push(g.agent_prompt.trim());
      out.push("````");
      out.push("");
    }
    out.push(`Suggested commit message:`);
    out.push("");
    out.push("```");
    out.push(`${batch.type}: ${batch.label.toLowerCase()}`);
    out.push("");
    out.push(batch.gaps.map((g) => `- ${g.id}: ${g.manual_fix.what}`).join("\n"));
    out.push("```");
    out.push("");
  }

  out.push(`---`);
  out.push("");
  out.push(`_${BRAND.disclaimer}_`);
  return out.join("\n");
}

function batchGaps(gaps: ReturnType<typeof remediationOrder>) {
  const groups: { label: string; type: string; gaps: typeof gaps }[] = [];
  const push = (label: string, type: string, list: typeof gaps) => {
    if (list.length) groups.push({ label, type, gaps: list });
  };

  const isDoc = (g: (typeof gaps)[number]) =>
    /polic|document|record|ropa|dpia|notice|register|agreement/i.test(g.manual_fix.what);
  const isSchema = (g: (typeof gaps)[number]) =>
    /column|table|migration|schema|index|field/i.test(g.manual_fix.what);
  const isSecurity = (g: (typeof gaps)[number]) =>
    g.adversary_findings.length > 0 || /key|secret|rls|policy|auth|header|encrypt/i.test(g.manual_fix.what);

  const critical = gaps.filter((g) => g.severity === "critical");
  const rest = gaps.filter((g) => g.severity !== "critical");

  push("Stop the bleeding (critical)", "fix", critical);
  push("Data model and migrations", "feat", rest.filter(isSchema));
  push("Security controls", "fix", rest.filter((g) => !isSchema(g) && isSecurity(g)));
  push("Compliance documentation", "docs", rest.filter((g) => !isSchema(g) && !isSecurity(g) && isDoc(g)));
  push(
    "Everything else",
    "chore",
    rest.filter((g) => !isSchema(g) && !isSecurity(g) && !isDoc(g)),
  );
  return groups;
}
