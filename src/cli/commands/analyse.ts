import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BRAND } from "../../brand.ts";
import { loadConfig } from "../../config/index.ts";
import { paths as makePaths, readJsonl, writeJson, writeOut, readJson , readBytes } from "../../util/paths.ts";
import { log, UserError, color } from "../../util/log.ts";
import { hashObject, sha256 } from "../../util/hash.ts";
import { humanDuration, nowIso, sleep } from "../../util/time.ts";
import { Sovereignty } from "../../sovereignty/index.ts";
import type { EgressRecord } from "../../sovereignty/gate.ts";
import { runScan, loadLatestResult, loadResult } from "../../phases/pipeline.ts";
import { runCorpus } from "../../phases/p2-corpus.ts";
import { requireAuthorization } from "../../phases/p4-adversary.ts";
import { runEmit } from "../../phases/p6-emit.ts";
import { createProviders } from "../../providers/index.ts";
import { computeRoi } from "../../roi/engine.ts";
import { loadAssumptions } from "../../roi/assumptions.ts";
import { renderRoi, renderLedger, renderReport } from "../../render/markdown.ts";
import { severityRank, type Gap, type ScanResult } from "../../schemas/index.ts";
import type { PhaseId } from "../../util/journal.ts";
import { heading, kv, table, ok, bad, warn, info, bytes, severityColor } from "../ui.ts";
import { flagBool, flagList, flagString, type ParsedArgs } from "../args.ts";
import { requireConfig } from "./setup.ts";

/* ───────────────────────────── scan ───────────────────────────── */

export async function cmdScan(args: ParsedArgs): Promise<number> {
  const { cfg, p } = requireConfig();
  const started = Date.now();

  const phases = flagList(args.flags, "phases")?.map((n) => Number(n) as PhaseId);
  const level = flagString(args.flags, "sovereignty");

  heading(`${BRAND.display} scan — ${cfg.project.name}`);
  kv("Regions", cfg.regions.join(", "));
  kv("Frameworks", cfg.frameworks.join(", ") || "none");
  kv("Sovereignty", `level ${level ?? cfg.sovereignty.level}`);
  kv("Budget", `$${(cfg.budget.per_run_usd.research + cfg.budget.per_run_usd.security + cfg.budget.per_run_usd.architect).toFixed(2)} per run`);
  log.blank();

  const outcome = await runScan({
    cfg,
    paths: p,
    phases,
    resume: flagString(args.flags, "resume"),
    since: flagString(args.flags, "since"),
    offline: flagBool(args.flags, "offline"),
    dryRun: flagBool(args.flags, "dry-run"),
    sovereigntyLevel: level === undefined ? undefined : (Number(level) as 0 | 1 | 2),
    formats: flagList(args.flags, "format"),
    noStress: flagBool(args.flags, "no-stress"),
    force: flagBool(args.flags, "force"),
  });

  if (flagBool(args.flags, "dry-run")) return 0;

  const gaps = outcome.result.gaps;
  log.blank();
  if (gaps.length) {
    table(
      ["id", "sev", "title"],
      gaps.slice(0, 12).map((g) => [g.id, severityColor(g.severity), truncate(g.title, 62)]),
    );
    if (gaps.length > 12) log.raw(color.gray(`  …and ${gaps.length - 12} more. \`${BRAND.name} gaps\` to browse.`));
  }
  log.blank();
  log.raw(`  Report:    ${join(p.out, "REPORT.md")}`);
  log.raw(`  Summary:   ${join(p.out, "EXECUTIVE_SUMMARY.md")}`);
  log.raw(`  ROI:       ${join(p.out, "ROI.md")}`);
  log.raw(`  Prompts:   ${p.outPrompts}/`);
  log.raw(`  What left: ${join(p.out, "SOVEREIGNTY.md")}`);
  log.blank();
  log.raw(color.gray(`  ${humanDuration(Date.now() - started)} · ${BRAND.disclaimerShort}`));
  return outcome.incomplete ? 0 : 0;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/* ───────────────────────────── sovereignty ───────────────────────────── */

export async function cmdSovereignty(args: ParsedArgs): Promise<number> {
  const { cfg, p } = requireConfig();
  const sub = args.sub[0] ?? "preview";

  switch (sub) {
    case "preview": {
      // Ephemeral map: a preview writes nothing and contacts nothing.
      const sov = Sovereignty.create(cfg, p, undefined, true);
      const entries = sov.preview(flagBool(args.flags, "full") ? 100_000 : 900);
      const sent = entries.filter((e) => e.status === "sent");
      const denied = entries.filter((e) => e.status !== "sent");

      heading(`Exactly what would leave this machine — level ${sov.level}`);
      log.raw(
        color.gray(
          `  Nothing has been sent. This is a local render of the redactor's output, produced before\n` +
            `  any call is made.`,
        ),
      );
      log.blank();

      const filter = flagString(args.flags, "file");
      for (const e of sent) {
        if (filter && !e.path.includes(filter)) continue;
        log.raw(color.bold(`  ${e.path}`));
        log.raw(
          color.gray(
            `    → ${e.sealed_path}   ${bytes(e.original_bytes)} → ${bytes(e.sealed_bytes)}` +
              `   ${e.identifiers_mapped} ident, ${e.literals_placeheld} literal, ` +
              `${e.comments_stripped} comment${e.literals_dropped ? `, ${color.red(`${e.literals_dropped} dropped`)}` : ""}`,
          ),
        );
        if (e.preview) {
          for (const line of e.preview.split("\n").slice(0, flagBool(args.flags, "full") ? 10_000 : 14)) {
            log.raw(color.gray("    │ ") + line);
          }
          if (!flagBool(args.flags, "full") && e.preview.split("\n").length > 14) {
            log.raw(color.gray("    │ …"));
          }
        }
        log.blank();
      }

      if (denied.length && !filter) {
        log.raw(color.bold(`  Never sent (${denied.length})`));
        for (const e of denied.slice(0, 30)) {
          log.raw(`    ${color.red("✗")} ${e.path.padEnd(52)} ${color.gray(e.reason ?? "")}`);
        }
        if (denied.length > 30) log.raw(color.gray(`    …and ${denied.length - 30} more`));
        log.blank();
      }

      const totalIn = sent.reduce((n, e) => n + e.original_bytes, 0);
      const totalOut = sent.reduce((n, e) => n + e.sealed_bytes, 0);
      log.raw(
        `  ${sent.length} file(s) would be sent · ${bytes(totalIn)} → ${bytes(totalOut)} · ` +
          `${denied.length} refused outright`,
      );
      log.raw(color.gray(`  The pseudonym map that reverses this never leaves ${p.map}`));
      return 0;
    }

    case "map": {
      if (!existsSync(p.map)) {
        log.raw(info("No pseudonym map yet — run a scan first."));
        return 0;
      }
      const sov = Sovereignty.create(cfg, p);
      heading(`Pseudonym map (${sov.map.size} entries) — local only, never transmitted`);
      const entries = sov.map.entries().sort((a, b) => a.pseudonym.localeCompare(b.pseudonym));
      const filter = flagString(args.flags, "filter");
      table(
        ["pseudonym", "real"],
        entries
          .filter((e) => !filter || e.real.includes(filter) || e.pseudonym.includes(filter))
          .slice(0, flagBool(args.flags, "all") ? 100_000 : 60)
          .map((e) => [e.pseudonym, e.real]),
      );
      if (!flagBool(args.flags, "all") && entries.length > 60) {
        log.raw(color.gray(`  …and ${entries.length - 60} more. --all to see everything.`));
      }
      log.blank();
      const mode = statSync(p.map).mode & 0o777;
      log.raw(
        mode === 0o600
          ? ok(`${p.map} is mode 0600`)
          : warn(`${p.map} is mode ${mode.toString(8)} — expected 0600`),
      );
      return 0;
    }

    case "ledger": {
      const records = readJsonl<EgressRecord>(p.egress);
      if (!records.length) {
        log.raw(info("Nothing has ever been sent from this project."));
        return 0;
      }
      heading(`Egress ledger — every outbound byte`);
      const runFilter = flagString(args.flags, "run");
      const filtered = runFilter ? records.filter((r) => r.run_id === runFilter) : records;
      table(
        ["time", "phase", "destination", "bytes", "level", "files", "sha256"],
        filtered.slice(-40).map((r) => [
          r.ts.slice(0, 19).replace("T", " "),
          String(r.phase),
          r.destination,
          bytes(r.bytes),
          String(r.sovereignty_level),
          String(r.files_represented.length),
          r.payload_sha256.slice(0, 10),
        ]),
      );
      log.blank();
      const total = filtered.reduce((n, r) => n + r.bytes, 0);
      kv("Requests", String(filtered.length));
      kv("Total bytes", bytes(total));
      kv("Destinations", [...new Set(filtered.map((r) => r.destination))].join(", "));
      log.blank();
      log.raw(color.gray(`  Full records, including which real paths each payload covered: ${p.egress}`));
      return 0;
    }

    case "level": {
      const level = args.sub[1];
      if (!["0", "1", "2"].includes(level ?? "")) {
        throw new UserError("Usage: addgp-lite sovereignty level <0|1|2>");
      }
      const n = Number(level) as 0 | 1 | 2;
      if (n === 2) {
        log.raw(
          warn(
            "Level 2 sends source verbatim. It applies only to paths in sovereignty.verbatim_allowlist —\n" +
              "  it is never a global setting, and an empty allowlist means every file stays at level 1.",
          ),
        );
        const confirm = flagBool(args.flags, "yes")
          ? "verbatim"
          : (await promptTyped("  Type 'verbatim' to confirm: "));
        if (confirm !== "verbatim") {
          log.raw(info("Unchanged."));
          return 1;
        }
      }
      cfg.sovereignty.level = n;
      const { saveConfig } = await import("../../config/index.ts");
      saveConfig(p.config, cfg);
      log.raw(ok(`Sovereignty level set to ${n} (${["structural", "pseudonymised", "verbatim"][n]}).`));
      return 0;
    }

    default:
      throw new UserError(`Unknown subcommand: sovereignty ${sub}`, "Try: preview, map, ledger, level");
  }
}

async function promptTyped(text: string): Promise<string> {
  const { promptLine } = await import("../../keys/index.ts");
  return promptLine(text, "");
}

/* ───────────────────────────── gaps / prompt / fix ───────────────────────────── */

function requireResult(p: ReturnType<typeof makePaths>): ScanResult {
  const latest = loadLatestResult(p);
  if (!latest) {
    throw new UserError(
      "No completed scan found.",
      `Run \`${BRAND.name} scan\` first. Results are cached, so re-rendering afterwards costs nothing.`,
    );
  }
  return latest.result;
}

export async function cmdGaps(args: ParsedArgs): Promise<number> {
  const { p } = requireConfig();
  const result = requireResult(p);
  let gaps = result.gaps;

  const sev = flagString(args.flags, "severity");
  if (sev) gaps = gaps.filter((g) => severityRank(g.severity) <= severityRank(sev));
  const regime = flagString(args.flags, "regime");
  if (regime) gaps = gaps.filter((g) => g.regions.includes(regime) || g.obligations.some((o) => o.startsWith(regime)));
  if (flagBool(args.flags, "open")) {
    const baseline = readJson<{ gaps: string[] } | null>(p.baseline, null);
    if (baseline) gaps = gaps.filter((g) => !baseline.gaps.includes(gapKey(g)));
  }

  if (flagBool(args.flags, "json")) {
    log.raw(JSON.stringify(gaps, null, 2));
    return 0;
  }

  const id = args.sub[0];
  if (id) {
    const gap = gaps.find((g) => g.id.toLowerCase() === id.toLowerCase());
    if (!gap) throw new UserError(`No gap ${id} in the latest scan.`);
    showGap(gap, result);
    return 0;
  }

  heading(`Gaps (${gaps.length})`);
  if (!gaps.length) {
    log.raw(info("No gaps match. That is not the same as compliant — check the indeterminate items in REPORT.md."));
    return 0;
  }
  table(
    ["id", "sev", "title", "regions", "effort", "owner"],
    gaps.map((g) => [
      g.id,
      severityColor(g.severity),
      truncate(g.title, 52),
      g.regions.join(","),
      `${g.manual_fix.effort.engineering_days}d`,
      g.owner_hint,
    ]),
  );
  log.blank();
  log.raw(color.gray(`  ${BRAND.name} gaps <id>        full detail`));
  log.raw(color.gray(`  ${BRAND.name} prompt <id>      the agent prompt for one gap`));
  log.raw(color.gray(`  ${BRAND.name} fix <id>         the manual What/Why/How/Consequence`));
  return 0;
}

function gapKey(g: Gap): string {
  return `${g.obligations.join(",")}|${g.title.toLowerCase().slice(0, 80)}`;
}

function showGap(g: Gap, result: ScanResult): void {
  heading(`${g.id} — ${g.title}`);
  kv("Severity", severityColor(g.severity));
  kv("Status", g.status);
  kv("Confidence", `${(g.confidence * 100).toFixed(0)}%`);
  kv("Regions", g.regions.join(", "));
  kv("Owner", g.owner_hint);
  kv("Effort", `${g.manual_fix.effort.engineering_days} day(s)${g.manual_fix.effort.legal_review ? " + legal review" : ""}${g.manual_fix.effort.vendor_action ? " + vendor action" : ""}`);
  log.blank();
  log.raw(color.bold("  What"));
  log.raw(`  ${wrapText(g.manual_fix.what, 92, "  ")}`);
  log.blank();
  log.raw(color.bold("  Why"));
  log.raw(`  ${color.gray("legally:")} ${wrapText(g.manual_fix.why.legal, 92, "  ")}`);
  log.raw(`  ${color.gray("in code:")} ${wrapText(g.manual_fix.why.engineering, 92, "  ")}`);
  for (const obId of g.obligations) {
    const ob = result.obligations.find((o) => o.id === obId);
    if (ob) log.raw(color.gray(`    ${ob.instrument} ${ob.provision} — ${ob.citations[0]?.url ?? ""}`));
  }
  log.blank();
  log.raw(color.bold("  How"));
  for (const [i, step] of g.manual_fix.how.entries()) {
    log.raw(`  ${String(i + 1).padStart(2)}. ${wrapText(step.replace(/^\d+\.\s*/, ""), 88, "      ")}`);
  }
  log.blank();
  log.raw(color.bold("  Consequence"));
  log.raw(`  ${color.gray("unfixed: ")}${wrapText(g.manual_fix.consequence.if_unfixed, 92, "  ")}`);
  log.raw(`  ${color.gray("fixed:   ")}${wrapText(g.manual_fix.consequence.if_fixed, 92, "  ")}`);
  log.raw(`  ${color.yellow("residual:")} ${wrapText(g.manual_fix.consequence.residual_risk, 92, "  ")}`);
  log.blank();
  const max = g.exposure.financial.statutory_maximum;
  log.raw(color.bold("  Exposure"));
  log.raw(
    max
      ? `  Statutory maximum: ${max.currency} ${max.amount.toLocaleString()} — ${max.citation.url}`
      : `  Statutory maximum: ${color.gray("not quantified — the cited instrument states no figure")}`,
  );
  for (const [k, v] of Object.entries(g.exposure.non_financial)) {
    if (v) log.raw(`  ${k.replace(/_/g, " ")}: ${v}`);
  }
  log.blank();
  log.raw(color.gray(`  ${BRAND.name} prompt ${g.id}   to get the pasteable agent prompt`));
}

function wrapText(text: string, width: number, indent: string): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (!line) line = w;
    else if ((line + " " + w).length <= width) line += " " + w;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n" + indent);
}

export async function cmdPrompt(args: ParsedArgs): Promise<number> {
  const { p } = requireConfig();
  const result = requireResult(p);

  if (flagBool(args.flags, "all")) {
    const file = join(p.outPrompts, "00-MASTER.md");
    if (!existsSync(file)) throw new UserError("No master prompt found. Re-run `addgp-lite report`.");
    log.raw(readFileSync(file, "utf8"));
    return 0;
  }

  const id = args.sub[0];
  if (!id) throw new UserError("Usage: addgp-lite prompt <gap-id> [--all]");
  const gap = result.gaps.find((g) => g.id.toLowerCase() === id.toLowerCase());
  if (!gap) throw new UserError(`No gap ${id} in the latest scan.`);
  // Raw to stdout so it pipes cleanly into pbcopy/xclip.
  log.raw(gap.agent_prompt);
  return 0;
}

export async function cmdFix(args: ParsedArgs): Promise<number> {
  const { p } = requireConfig();
  const result = requireResult(p);
  const id = args.sub[0];
  if (!id) throw new UserError("Usage: addgp-lite fix <gap-id>");
  const gap = result.gaps.find((g) => g.id.toLowerCase() === id.toLowerCase());
  if (!gap) throw new UserError(`No gap ${id} in the latest scan.`);
  showGap(gap, result);
  log.blank();
  log.raw(color.bold("  Verify"));
  for (const v of gap.manual_fix.verify) log.raw(`    ${v}`);
  return 0;
}

/* ───────────────────────────── ledger / roi / report ───────────────────────────── */

export async function cmdLedger(args: ParsedArgs): Promise<number> {
  const { cfg, p } = requireConfig();
  const result = requireResult(p);

  if (flagBool(args.flags, "json")) {
    log.raw(JSON.stringify(result.gaps.map((g) => ({ id: g.id, exposure: g.exposure })), null, 2));
    return 0;
  }

  const md = renderLedger(result, cfg);
  const file = join(p.out, "LEDGER.md");
  writeOut(file, md);

  const quantified = result.gaps.filter((g) => g.exposure.financial.statutory_maximum);
  heading("Legal exposure ledger");
  kv("Gaps", String(result.gaps.length));
  kv("With a cited maximum", String(quantified.length));
  kv("Not quantified", String(result.gaps.length - quantified.length));
  log.blank();
  if (quantified.length) {
    table(
      ["gap", "regime", "cited maximum"],
      quantified.map((g) => {
        const m = g.exposure.financial.statutory_maximum!;
        return [g.id, g.regions.join(","), `${m.currency} ${m.amount.toLocaleString()}`];
      }),
    );
    log.blank();
  }
  log.raw(
    color.gray(
      `  These are not added together. Regulators do not stack statutory maxima across regimes, and a\n` +
        `  headline total would be a fiction — the kind that loses you the one lawyer who reads the report.`,
    ),
  );
  log.blank();
  log.raw(`  Full ledger: ${file}`);

  /* trend across runs */
  const trend = trendAcrossRuns(p);
  if (trend.length > 1) {
    log.blank();
    log.raw(color.bold("  Trend"));
    table(
      ["run", "gaps", "critical", "high"],
      trend.map((t) => [t.runId.slice(0, 15), String(t.gaps), String(t.critical), String(t.high)]),
    );
  }
  return 0;
}

function trendAcrossRuns(p: ReturnType<typeof makePaths>): { runId: string; gaps: number; critical: number; high: number }[] {
  const out: { runId: string; gaps: number; critical: number; high: number }[] = [];
  const runsDir = p.runs;
  if (!existsSync(runsDir)) return out;
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  for (const runId of readdirSync(runsDir).sort().slice(-8)) {
    const r = loadResult(p, runId);
    if (!r) continue;
    out.push({
      runId,
      gaps: r.gaps.length,
      critical: r.gaps.filter((g) => g.severity === "critical").length,
      high: r.gaps.filter((g) => g.severity === "high").length,
    });
  }
  return out;
}

export async function cmdRoi(args: ParsedArgs): Promise<number> {
  const { cfg, p } = requireConfig();
  const result = requireResult(p);

  const assumptionsFile = flagString(args.flags, "assumptions") ?? p.assumptions;
  const { assumptions, customised } = loadAssumptions(assumptionsFile);

  const spendBySeat: Record<string, number> = result.meta.cost_usd;
  const spendByPhase: Record<string, number> = {};
  const records = readJsonl<{ run_id: string; phase: number; cost_usd: number; cost_reported: boolean }>(p.cost);
  let reported = false;
  for (const r of records.filter((x) => x.run_id === result.meta.run_id)) {
    spendByPhase[r.phase] = (spendByPhase[r.phase] ?? 0) + r.cost_usd;
    if (r.cost_reported) reported = true;
  }

  const roi = computeRoi({
    cfg,
    result,
    meta: result.meta,
    assumptions,
    assumptionsCustomised: customised,
    wallClockMs: result.meta.duration_ms,
    spendBySeat,
    spendByPhase,
    costReportedByVendor: reported,
  });

  if (flagBool(args.flags, "json")) {
    log.raw(JSON.stringify(roi, null, 2));
    return 0;
  }

  const md = renderRoi(roi, cfg, assumptions);
  writeOut(join(p.out, "ROI.md"), md);
  writeJson(join(p.out, "roi.json"), roi);

  heading("ROI");
  log.raw(`  ${wrapText(roi.headline, 92, "  ")}`);
  log.blank();
  table(
    ["", "value", "from"],
    [
      ["API spend", `$${roi.spend.total_usd.toFixed(4)}`, roi.spend.reported_by_vendor ? "vendor-reported" : "estimated"],
      ["Wall clock", `${roi.spend.wall_clock_minutes} min`, "measured"],
      ["Obligations", String(roi.counts.obligations_retrieved), `${roi.counts.obligations_verified} double-sourced`],
      ["Code paths", String(roi.counts.code_paths_reviewed), "counted"],
      ["Gaps", String(roi.counts.gaps), `${roi.counts.agent_prompts_generated} agent prompts`],
      [
        "Hours replaced",
        `${roi.time_saved.total_hours.low.toFixed(1)}–${roi.time_saved.total_hours.high.toFixed(1)}`,
        roi.time_saved.total_hours.unsourced ? "unsourced assumptions" : "sourced assumptions",
      ],
    ],
  );
  log.blank();
  if (roi.hours_only) {
    log.raw(color.gray("  Student profile: labour valued at zero currency, reported in hours only."));
  }
  if (roi.unsourced_assumptions.length) {
    log.raw(
      warn(
        `${roi.unsourced_assumptions.length} assumption(s) are unsourced and marked as such in ROI.md. ` +
          `Edit ${assumptionsFile} and re-run.`,
      ),
    );
  }
  log.blank();
  log.raw(`  ${join(p.out, "ROI.md")}`);
  return 0;
}

export async function cmdReport(args: ParsedArgs): Promise<number> {
  const { cfg, p } = requireConfig();
  const result = requireResult(p);
  const formats = flagList(args.flags, "format") ?? ["md", "json", "sarif"];
  const sov = Sovereignty.create(cfg, p);

  const spendBySeat: Record<string, number> = result.meta.cost_usd;
  const spendByPhase: Record<string, number> = {};
  const records = readJsonl<{ run_id: string; phase: number; cost_usd: number; cost_reported: boolean }>(p.cost);
  let reported = false;
  for (const r of records.filter((x) => x.run_id === result.meta.run_id)) {
    spendByPhase[r.phase] = (spendByPhase[r.phase] ?? 0) + r.cost_usd;
    if (r.cost_reported) reported = true;
  }

  heading("Re-rendering from cache — no model calls");
  const emitted = runEmit({
    cfg, paths: p, sov, result,
    wallClockMs: result.meta.duration_ms,
    spendBySeat,
    spendByPhase,
    costReportedByVendor: reported,
    formats,
  });
  for (const f of emitted.files.slice(0, 24)) log.raw(`  ${f}`);
  if (emitted.files.length > 24) log.raw(color.gray(`  …and ${emitted.files.length - 24} more`));
  log.blank();
  log.raw(color.gray(`  Formats: ${formats.join(", ")}. This cost nothing — everything came from the cached run.`));
  return 0;
}

/* ───────────────────────────── diff ───────────────────────────── */

export async function cmdDiff(args: ParsedArgs): Promise<number> {
  const { p } = requireConfig();
  const [a, b] = args.sub;
  if (!a || !b) throw new UserError("Usage: addgp-lite diff <run-a> <run-b>");
  const ra = loadResult(p, a);
  const rb = loadResult(p, b);
  if (!ra) throw new UserError(`No result stored for run ${a}`);
  if (!rb) throw new UserError(`No result stored for run ${b}`);

  const keyA = new Map(ra.gaps.map((g) => [gapKey(g), g]));
  const keyB = new Map(rb.gaps.map((g) => [gapKey(g), g]));

  const opened = [...keyB].filter(([k]) => !keyA.has(k)).map(([, g]) => g);
  const closed = [...keyA].filter(([k]) => !keyB.has(k)).map(([, g]) => g);

  const lawA = new Map(ra.obligations.map((o) => [o.id, o]));
  const lawChanged = rb.obligations.filter((o) => {
    const prev = lawA.get(o.id);
    return prev && hashObject(prev.obligation_text) !== hashObject(o.obligation_text);
  });
  const lawNew = rb.obligations.filter((o) => !lawA.has(o.id));

  heading(`diff ${a} → ${b}`);
  kv("Gaps", `${ra.gaps.length} → ${rb.gaps.length}`);
  kv("Opened", String(opened.length));
  kv("Closed", String(closed.length));
  kv("Obligations", `${ra.obligations.length} → ${rb.obligations.length}`);
  log.blank();

  if (opened.length) {
    log.raw(color.bold("  New gaps"));
    for (const g of opened) log.raw(`    ${color.red("+")} ${g.id} ${severityColor(g.severity)} ${truncate(g.title, 60)}`);
    log.blank();
  }
  if (closed.length) {
    log.raw(color.bold("  Closed gaps"));
    for (const g of closed) log.raw(`    ${color.green("-")} ${g.id} ${severityColor(g.severity)} ${truncate(g.title, 60)}`);
    log.blank();
  }
  if (lawChanged.length || lawNew.length) {
    log.raw(color.bold("  Changed law"));
    for (const o of lawChanged) log.raw(`    ${color.yellow("~")} ${o.instrument} ${o.provision} — text changed since ${a}`);
    for (const o of lawNew) log.raw(`    ${color.cyan("+")} ${o.instrument} ${o.provision} — newly retrieved`);
    log.blank();
  }
  if (!opened.length && !closed.length && !lawChanged.length && !lawNew.length) {
    log.raw(info("No change in gaps or law between these runs."));
  }
  return 0;
}

/* ───────────────────────────── ci ───────────────────────────── */

export async function cmdCi(args: ParsedArgs): Promise<number> {
  const { cfg, p } = requireConfig();
  const threshold = flagString(args.flags, "fail-on") ?? cfg.ci.fail_on;

  if (flagBool(args.flags, "update-baseline")) {
    const result = requireResult(p);
    writeJson(p.baseline, {
      created_at: nowIso(),
      run_id: result.meta.run_id,
      gaps: result.gaps.map(gapKey),
    });
    log.raw(ok(`Baseline updated: ${result.gaps.length} gap(s) recorded as accepted.`));
    return 0;
  }

  const outcome = await runScan({
    cfg,
    paths: p,
    offline: flagBool(args.flags, "offline"),
    formats: ["md", "json", "sarif"],
    force: true, // CI reports contradictions rather than stopping on them
    noStress: true,
  });

  const baseline = readJson<{ gaps: string[] } | null>(p.baseline, null);
  const known = new Set(baseline?.gaps ?? []);
  const newGaps = outcome.result.gaps.filter((g) => !known.has(gapKey(g)));
  const failing = newGaps.filter((g) => severityRank(g.severity) <= severityRank(threshold));

  log.blank();
  heading("CI result");
  kv("Total gaps", String(outcome.result.gaps.length));
  kv("Baseline", baseline ? `${known.size} accepted` : "none recorded");
  kv("New since baseline", String(newGaps.length));
  kv("Fail threshold", threshold);
  log.blank();

  if (failing.length) {
    for (const g of failing) {
      log.raw(bad(`${g.id} ${severityColor(g.severity)} ${g.title}`));
      log.raw(color.gray(`     ${g.manual_fix.what}`));
    }
    log.blank();
    log.raw(bad(`${failing.length} new gap(s) at or above ${threshold}.`));
    log.raw(color.gray(`  Accept them deliberately with: ${BRAND.name} ci --update-baseline`));
    return 1;
  }

  log.raw(ok(`No new gaps at or above ${threshold}.`));
  if (outcome.incomplete) {
    log.raw(warn("The run was incomplete — some phases did not execute. See REPORT.md for what was not checked."));
  }
  return 0;
}

/* ───────────────────────────── watch ───────────────────────────── */

export async function cmdWatch(args: ParsedArgs): Promise<number> {
  const { cfg, p } = requireConfig();
  const result = requireResult(p);
  const intervalHours = Number(flagString(args.flags, "interval") ?? "24");
  const once = flagBool(args.flags, "once");

  heading("Watching the corpus for changes in cited law");
  log.raw(
    color.gray(
      `  Re-runs phase 2 only. Your code is not re-read and nothing else is spent.\n` +
        `  Interval: ${intervalHours}h${once ? " (single pass)" : ""}. Ctrl-C to stop.`,
    ),
  );

  const before = new Map(result.obligations.map((o) => [o.id, hashObject(o.obligation_text)]));

  for (;;) {
    const providers = createProviders(cfg, p, `watch-${Date.now()}`);
    const sov = Sovereignty.create(cfg, p);
    log.blank();
    log.raw(color.gray(`  ${nowIso()} — checking…`));

    try {
      const corpus = await runCorpus({ cfg, paths: p, sov, providers, profile: result.profile });
      let changes = 0;
      for (const o of corpus.obligations) {
        const prev = before.get(o.id);
        const now = hashObject(o.obligation_text);
        if (prev && prev !== now) {
          changes++;
          log.raw(warn(`CHANGED: ${o.instrument} ${o.provision}`));
          log.raw(color.gray(`    ${o.citations[0]?.url ?? ""}`));
          log.raw(color.gray(`    Re-run a full scan: this may open or close gaps.`));
        }
        if (!prev) {
          changes++;
          log.raw(info(`NEW: ${o.instrument} ${o.provision}`));
        }
        before.set(o.id, now);
      }
      if (!changes) log.raw(ok("No change in the cited law."));
    } catch (e) {
      log.raw(warn(`Check failed: ${e instanceof Error ? e.message : String(e)}`));
    }

    if (once) return 0;
    await sleep(intervalHours * 3_600_000);
  }
}

/* ───────────────────────────── export ───────────────────────────── */

export async function cmdExport(args: ParsedArgs): Promise<number> {
  const { cfg, p } = requireConfig();
  const result = requireResult(p);
  const out = flagString(args.flags, "out") ?? `addgp-audit-${result.meta.run_id}.zip`;

  if (!existsSync(p.out)) {
    throw new UserError("No compliance/ directory. Run a scan first.");
  }

  /* manifest with hashes, so an auditor can verify nothing changed */
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const files: { path: string; sha256: string; bytes: number }[] = [];
  const walkOut = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const st = statSync(abs);
      if (st.isDirectory()) {
        walkOut(abs, `${prefix}${name}/`);
      } else {
        files.push({
          path: `${prefix}${name}`,
          sha256: sha256(readBytes(abs)),
          bytes: st.size,
        });
      }
    }
  };
  walkOut(p.out, "");

  const manifest = {
    tool: BRAND.name,
    version: BRAND.version,
    generated_at: nowIso(),
    run: result.meta,
    project: cfg.project.name,
    regions: cfg.regions,
    obligations: result.obligations.length,
    gaps: result.gaps.length,
    files,
    disclaimer: BRAND.disclaimer,
    note:
      "This bundle contains the report, the evidence it rests on, the citations for every legal claim, " +
      "and a SHA-256 per file. It does NOT contain the pseudonym map, any API key, or any source code.",
  };
  writeJson(join(p.out, "MANIFEST.json"), manifest);

  const r = Bun.spawnSync({
    cmd: ["zip", "-r", "-q", out, BRAND.outDir],
    cwd: p.root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (r.exitCode !== 0) {
    const tar = out.replace(/\.zip$/, ".tar.gz");
    const r2 = Bun.spawnSync({
      cmd: ["tar", "-czf", tar, BRAND.outDir],
      cwd: p.root,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (r2.exitCode !== 0) {
      throw new UserError(`Could not create an archive: neither zip nor tar succeeded.`);
    }
    log.raw(ok(`Auditor bundle: ${tar} (${bytes(statSync(join(p.root, tar)).size)})`));
  } else {
    log.raw(ok(`Auditor bundle: ${out} (${bytes(statSync(join(p.root, out)).size)})`));
  }

  log.blank();
  kv("Files", String(files.length));
  kv("Obligations", String(result.obligations.length));
  kv("Gaps", String(result.gaps.length));
  log.blank();
  log.raw(color.gray(`  Contains: report, evidence, citations, SBOM, SARIF, and a SHA-256 per file.`));
  log.raw(color.gray(`  Does not contain: the pseudonym map, any key, or any source code.`));
  return 0;
}

/* ───────────────────────────── share ───────────────────────────── */

export async function cmdShare(args: ParsedArgs): Promise<number> {
  const { cfg, p } = requireConfig();
  const result = requireResult(p);

  if (flagBool(args.flags, "badge")) {
    const badge =
      `![${BRAND.display}](https://img.shields.io/badge/` +
      `${encodeURIComponent(BRAND.display)}-${encodeURIComponent(`${result.gaps.length} gaps · ${cfg.regions.join("/")}`)}-blue)`;
    const md =
      `${badge}\n\n` +
      `<!-- Scanned ${result.meta.finished_at.slice(0, 10)} with ${BRAND.display} v${BRAND.version}. ` +
      `Regions: ${cfg.regions.join(", ")}. Gaps: ${result.gaps.length}. -->\n`;
    const file = join(p.out, "BADGE.md");
    writeOut(file, md);
    log.raw(md);
    log.raw(color.gray(`  Written to ${file}. Voluntary, self-hosted, no callback URL.`));
    return 0;
  }

  const bySeverity: Record<string, number> = {};
  for (const g of result.gaps) bySeverity[g.severity] = (bySeverity[g.severity] ?? 0) + 1;

  const baseline = readJson<{ gaps: string[] } | null>(p.baseline, null);
  const closed = baseline ? baseline.gaps.filter((k) => !result.gaps.some((g) => gapKey(g) === k)).length : 0;

  const { assumptions, customised } = loadAssumptions(p.assumptions);
  const roi = computeRoi({
    cfg, result, meta: result.meta, assumptions, assumptionsCustomised: customised,
    wallClockMs: result.meta.duration_ms,
    spendBySeat: result.meta.cost_usd,
    spendByPhase: {},
    costReportedByVendor: false,
  });

  /* counts only — no code, no paths, no finding text, no repo name, no identifiers */
  const receipt = {
    tool: BRAND.name,
    version: BRAND.version,
    generated_at: nowIso(),
    regions: cfg.regions,
    frameworks: cfg.frameworks,
    obligations_retrieved: result.obligations.length,
    obligations_double_sourced: result.obligations.filter((o) => o.verification === "double_sourced").length,
    gaps_by_severity: bySeverity,
    gaps_closed_since_last_run: closed,
    hours_saved_range: [
      Math.round(roi.time_saved.total_hours.low),
      Math.round(roi.time_saved.total_hours.high),
    ],
    api_spend_usd: Number(roi.spend.total_usd.toFixed(4)),
    sovereignty_level: result.meta.sovereignty_level,
    profile: cfg.project.profile,
    country: coarseCountry(cfg.regions),
  };
  const signature = sha256(JSON.stringify(receipt)).slice(0, 32);
  const signed = { ...receipt, signature };

  heading("Traction receipt");
  log.raw(
    color.gray(
      `  This is printed in full before it is written, so you can see exactly what you would be sharing.\n` +
        `  Counts only: no code, no file paths, no finding text, no repository name, no identifiers.`,
    ),
  );
  log.blank();
  log.raw(JSON.stringify(signed, null, 2));
  log.blank();

  const file = join(p.out, "traction-receipt.json");
  writeJson(file, signed);
  writeOut(join(p.out, "traction-receipt.md"), renderReceiptCard(signed, roi));

  log.raw(ok(`Written to ${file}`));
  log.raw(ok(`Card written to ${join(p.out, "traction-receipt.md")}`));
  log.blank();
  log.raw(
    color.gray(
      `  Nothing is sent anywhere. What you do with this file is your decision: send it to the ADDGP team,\n` +
        `  post it, attach it to a course submission, or delete it. This tool has no telemetry and no\n` +
        `  callback URL — it cannot phone home even if it wanted to.`,
    ),
  );
  void args;
  return 0;
}

function coarseCountry(regions: string[]): string {
  const primary = regions[0] ?? "unknown";
  return primary.split("-")[0] ?? "unknown";
}

function renderReceiptCard(receipt: Record<string, unknown>, roi: ReturnType<typeof computeRoi>): string {
  const sev = receipt.gaps_by_severity as Record<string, number>;
  return `# ${BRAND.display} — traction receipt

**${Object.values(sev).reduce((a, b) => a + b, 0)} gap(s)** found across **${(receipt.regions as string[]).join(", ")}**,
from **${receipt.obligations_retrieved}** obligations retrieved and verified against primary sources.

| | |
|---|---|
| Regions | ${(receipt.regions as string[]).join(", ")} |
| Obligations retrieved | ${receipt.obligations_retrieved} |
| Double-sourced | ${receipt.obligations_double_sourced} |
| Gaps | ${Object.entries(sev).map(([k, v]) => `${v} ${k}`).join(", ") || "none"} |
| Hours replaced | ${(receipt.hours_saved_range as number[]).join("–")} |
| API spend | $${receipt.api_spend_usd} |
| Sovereignty level | ${receipt.sovereignty_level} |

${roi.headline}

_Counts only. No code, no file paths, no finding text, no repository name, no identifiers.
Signature: \`${receipt.signature}\`._

_${BRAND.disclaimerShort}_
`;
}

/* ───────────────────────────── selfcheck ───────────────────────────── */

export async function cmdSelfcheck(args: ParsedArgs): Promise<number> {
  heading(`${BRAND.display} auditing itself`);
  log.raw(
    color.gray(
      `  A compliance tool that cannot pass its own scan has no standing. This runs the full pipeline\n` +
        `  against this binary's own source and prints the result, open gaps included.`,
    ),
  );
  log.blank();

  const source = flagString(args.flags, "source") ?? process.cwd();
  if (!existsSync(join(source, "src", "brand.ts"))) {
    throw new UserError(
      `${source} does not look like the ${BRAND.name} source tree.`,
      `Run this from a checkout, or pass --source <path>. A released binary has no source to scan; ` +
        `the SELF_COMPLIANCE.md shipped in its tarball is the output of this command at release time.`,
    );
  }

  const p = makePaths(source);
  const cfg = existsSync(p.config) ? loadConfig(p.config) : null;
  if (!cfg) {
    throw new UserError(
      `No ${BRAND.configFile} in the source tree.`,
      `The repository ships one so that selfcheck is reproducible. Run \`${BRAND.name} init\` there.`,
    );
  }

  const outcome = await runScan({
    cfg,
    paths: p,
    offline: flagBool(args.flags, "offline"),
    formats: ["md", "json"],
    force: true,
    noStress: true,
  });

  const critical = outcome.result.gaps.filter((g) => g.severity === "critical");
  const md = renderReport(outcome.result, cfg);
  writeOut(join(source, "SELF_COMPLIANCE.md"), md);

  log.blank();
  heading("Self-compliance");
  kv("Gaps", String(outcome.result.gaps.length));
  kv("Critical", String(critical.length));
  kv("Written to", join(source, "SELF_COMPLIANCE.md"));
  log.blank();

  if (critical.length) {
    log.raw(bad(`${critical.length} unresolved critical gap(s). No release should ship in this state.`));
    for (const g of critical) log.raw(`    ${g.id} ${g.title}`);
    return 1;
  }
  log.raw(ok("No unresolved critical gaps."));
  return 0;
}

/* ───────────────────────────── stress ───────────────────────────── */

export async function cmdStress(args: ParsedArgs): Promise<number> {
  const { p } = requireConfig();
  const sub = args.sub[0] ?? "list";

  if (sub === "list") {
    if (!existsSync(p.outStress)) {
      log.raw(info("No harnesses generated yet. They are produced by phase 4 of a scan."));
      return 0;
    }
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    heading("Generated stress harnesses");
    for (const f of readdirSync(p.outStress)) log.raw(`  ${join(p.outStress, f)}`);
    log.blank();
    log.raw(color.gray("  These are written to disk and never executed by this tool."));
    return 0;
  }

  if (sub === "run") {
    const target = flagString(args.flags, "target") ?? "http://localhost";
    requireAuthorization(p, target, flagBool(args.flags, "i-understand-this-is-production"));
    log.blank();
    log.raw(
      info(
        `Authorization checks passed for ${target}, but this tool still does not execute harnesses for you.\n` +
          `  Run them yourself with the tool they were written for:`,
      ),
    );
    log.blank();
    log.raw(color.gray(`    k6 run ${p.outStress}/<harness>.k6.js`));
    log.raw(color.gray(`    artillery run ${p.outStress}/<harness>.yml`));
    log.raw(color.gray(`    locust -f ${p.outStress}/<harness>.py`));
    log.blank();
    log.raw(
      color.gray(
        `  Deliberate: a compliance tool that fires load at a host on your behalf is a compliance tool\n` +
          `  that will one day fire load at the wrong host.`,
      ),
    );
    return 0;
  }

  throw new UserError(`Unknown subcommand: stress ${sub}`, "Try: list, run");
}
