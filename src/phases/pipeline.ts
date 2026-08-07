import { BRAND } from "../brand.ts";
import type { Config } from "../config/index.ts";
import { readText } from "../util/fswalk.ts";
import { readJson, writeJson, type Paths } from "../util/paths.ts";
import { log, UserError } from "../util/log.ts";
import { Journal, type PhaseId } from "../util/journal.ts";
import { gitChangedSince, gitHead } from "../util/git.ts";
import { humanDuration, newRunId, nowIso } from "../util/time.ts";
import { allPromptHashes } from "../util/prompts.ts";
import { hashObject } from "../util/hash.ts";
import { Sovereignty, walkRepo, type RedactedFile } from "../sovereignty/index.ts";
import { createProviders, ProviderSkipped, ProviderUnavailable, type Providers } from "../providers/index.ts";
import { BudgetExceeded } from "../providers/budget.ts";
import { runEvidence } from "./p3-evidence.ts";
import { runProfile } from "./p1-profile.ts";
import { runCorpus } from "./p2-corpus.ts";
import { runAdversary, type StressHarness } from "./p4-adversary.ts";
import { runAdjudicate } from "./p5-adjudicate.ts";
import { runEmit } from "./p6-emit.ts";
import type { ScanResult, RunMeta, EvidenceBundle, ProjectProfile } from "../schemas/index.ts";

export interface ScanOptions {
  cfg: Config;
  paths: Paths;
  phases?: PhaseId[];
  resume?: string;
  since?: string;
  offline?: boolean;
  dryRun?: boolean;
  sovereigntyLevel?: 0 | 1 | 2;
  formats?: string[];
  noStress?: boolean;
  /** proceed past blocking contradictions (CI, or the user has decided) */
  force?: boolean;
  userMinutes?: number;
}

export interface ScanOutcome {
  result: ScanResult;
  files: string[];
  incomplete: boolean;
}

const ALL_PHASES: PhaseId[] = [0, 1, 2, 3, 4, 5, 6];

/**
 * The pipeline of §2. Order is deliberate: phase 3 (local, free, sees real code)
 * runs before the phases that cost money, so a contradiction or a planted secret
 * stops the run before a single token is spent.
 */
export async function runScan(opts: ScanOptions): Promise<ScanOutcome> {
  const started = Date.now();
  const { cfg, paths } = opts;
  const runId = opts.resume ?? newRunId();
  const journal = new Journal(paths, runId);
  const phases = new Set(opts.phases ?? ALL_PHASES);
  const done = opts.resume ? journal.completed(runId) : new Set<PhaseId>();
  const skipped: { phase: number; reason: string }[] = [];
  let incomplete = false;

  if (opts.resume && done.size) {
    log.info(`Resuming run ${runId}; phases already complete: ${[...done].sort().join(", ")}`);
  }

  const providers = createProviders(cfg, paths, runId, opts.offline ?? false);

  /* ───────── phase 0: sovereignty ───────── */
  journal.write({ phase: 0, event: "start" });
  const sov = Sovereignty.create(cfg, paths, opts.sovereigntyLevel);
  const walked = walkRepo(paths.root, cfg);
  const changed = opts.since ? gitChangedSince(paths.root, opts.since) : null;
  if (opts.since && !changed) {
    log.warn(`Could not resolve --since ${opts.since}; scanning everything instead.`);
  }
  const targets = changed ? walked.filter((f) => changed.includes(f.path)) : walked;

  const redacted: RedactedFile[] = [];
  const droppedSecrets: number = (() => {
    let n = 0;
    for (const f of targets) {
      const source = readText(f.abs, f.ext);
      if (source === null) continue;
      const r = sov.redact(f.path, source);
      if (!r) continue;
      n += r.dropped.length;
      redacted.push(r);
    }
    return n;
  })();
  sov.save();

  log.ok(
    `Phase 0 sovereignty: ${redacted.length} file(s) prepared at level ${sov.level}, ` +
      `${sov.map.size} identifier(s) mapped` +
      (droppedSecrets ? `, ${droppedSecrets} secret-matching literal(s) dropped` : ""),
  );
  journal.write({ phase: 0, event: "done", detail: `${redacted.length} files` });

  if (opts.dryRun) {
    return dryRun(opts, sov, providers, redacted, runId, started);
  }

  /* ───────── phase 3: evidence (local, free, first) ───────── */
  let evidence: EvidenceBundle;
  const evidenceCache = cachedArtifact<EvidenceBundle>(paths, runId, "evidence");
  if (!phases.has(3) && evidenceCache) {
    evidence = evidenceCache;
    log.info("Phase 3 skipped (--phases); reusing cached evidence.");
  } else {
    journal.write({ phase: 3, event: "start" });
    evidence = runEvidence({
      cfg,
      paths,
      only: changed ?? undefined,
      scanHistory: true,
    });
    saveArtifact(paths, runId, "evidence", evidence);
    journal.write({ phase: 3, event: "done", detail: `${evidence.findings.length} findings` });
    log.ok(
      `Phase 3 evidence: ${evidence.findings.length} finding(s) across ${evidence.file_count} file(s), ` +
        `${evidence.sbom_component_count} dependency component(s)`,
    );
  }

  const criticalSecrets = evidence.findings.filter((f) => f.kind === "secret" && f.severity === "critical");
  if (criticalSecrets.length) {
    log.warn(
      `${criticalSecrets.length} committed credential(s) found. These are reported and never transmitted — ` +
        `rotate them regardless of what the rest of this report says.`,
    );
  }

  /* ───────── phase 1: profile ───────── */
  let profile: ProjectProfile;
  const profileCache = cachedArtifact<ProjectProfile>(paths, runId, "profile");
  if (!phases.has(1) && profileCache) {
    profile = profileCache;
    log.info("Phase 1 skipped (--phases); reusing cached profile.");
  } else if (!phases.has(1)) {
    throw new UserError(
      "Phase 1 was excluded but no cached profile exists for this run.",
      "Run the full pipeline once, or include phase 1 in --phases.",
    );
  } else {
    journal.write({ phase: 1, event: "start" });
    const res = await runProfile({ cfg, paths, sov, providers, evidence });
    profile = res.profile;
    saveArtifact(paths, runId, "profile", profile);
    journal.write({ phase: 1, event: "done" });

    const blocking = profile.contradictions.filter((c) => c.severity === "blocking");
    if (blocking.length && !opts.force) {
      log.blank();
      log.error(
        `Phase 1 found ${blocking.length} blocking contradiction(s) between your description and your code. ` +
          `Stopping before phase 2 spends money on the wrong regime.`,
      );
      log.blank();
      for (const c of blocking) {
        log.info(`  ${c.id}: ${c.claim}`);
        log.info(`      evidence: ${c.evidence}`);
        log.info(`      ${BRAND.name} needs to know: ${c.question}`);
        log.blank();
      }
      log.info(
        `Update ${cfg.project.description_file} to resolve these, then re-run. To proceed anyway, ` +
          `use --force — the contradictions will be reported in full.`,
      );
      throw new UserError("Stopped on blocking contradictions.", undefined, 3);
    }
    log.ok(
      `Phase 1 profile: ${profile.data_categories.length} data categor(ies), ` +
        `${profile.contradictions.length} contradiction(s), ${profile.open_questions.length} open question(s)`,
    );
  }

  /* ───────── phase 2: corpus ───────── */
  let corpus = { obligations: [] as ScanResult["obligations"], disputed: [] as ScanResult["disputed"], excluded: [] as ScanResult["excluded"], stale: false, queries_run: 0, trap_failures: 0 };
  const corpusCache = cachedArtifact<typeof corpus>(paths, runId, "corpus");
  if (!phases.has(2) && corpusCache) {
    corpus = corpusCache;
    log.info("Phase 2 skipped (--phases); reusing cached corpus.");
  } else if (phases.has(2)) {
    journal.write({ phase: 2, event: "start" });
    try {
      corpus = await runCorpus({ cfg, paths, sov, providers, profile });
      saveArtifact(paths, runId, "corpus", corpus);
      journal.write({ phase: 2, event: "done", detail: `${corpus.obligations.length} obligations` });
      log.ok(
        `Phase 2 corpus: ${corpus.obligations.length} obligation(s) retrieved and verified, ` +
          `${corpus.disputed.length} disputed, ${corpus.excluded.length} excluded ` +
          `(${corpus.queries_run} queries)`,
      );
    } catch (e) {
      if (e instanceof ProviderSkipped || e instanceof BudgetExceeded) {
        const stale = corpusCache;
        if (stale) {
          corpus = { ...stale, stale: true };
          log.warn(`Phase 2 unavailable (${describe(e)}); continuing on a cached corpus, banner-marked as stale.`);
        } else {
          skipped.push({ phase: 2, reason: describe(e) });
          incomplete = true;
          log.warn(`Phase 2 unavailable (${describe(e)}) and no cached corpus exists. No law was retrieved.`);
        }
        journal.write({ phase: 2, event: "skip", detail: describe(e) });
      } else {
        throw e;
      }
    }
  } else {
    skipped.push({ phase: 2, reason: "excluded by --phases with no cached corpus" });
    incomplete = true;
  }

  /* ───────── phase 4: adversary ───────── */
  let adversary: ScanResult["adversary"] = [];
  let harnesses: StressHarness[] = [];
  const adversaryCache = cachedArtifact<{ findings: ScanResult["adversary"]; harnesses: StressHarness[] }>(paths, runId, "adversary");
  if (!phases.has(4) && adversaryCache) {
    adversary = adversaryCache.findings;
    harnesses = adversaryCache.harnesses;
    log.info("Phase 4 skipped (--phases); reusing cached adversary findings.");
  } else if (phases.has(4)) {
    journal.write({ phase: 4, event: "start" });
    try {
      const res = await runAdversary({
        cfg, paths, sov, providers, profile, evidence,
        files: redacted,
        stress: !opts.noStress,
      });
      adversary = res.findings;
      harnesses = res.harnesses;
      saveArtifact(paths, runId, "adversary", { findings: adversary, harnesses });
      if (res.skipped) {
        skipped.push({ phase: 4, reason: res.skipped });
        incomplete = true;
      }
      journal.write({ phase: 4, event: "done", detail: `${adversary.length} findings` });
      log.ok(
        `Phase 4 adversary: ${adversary.length} finding(s) over ${res.batches} batch(es)` +
          (harnesses.length ? `, ${harnesses.length} stress harness(es) generated` : ""),
      );
    } catch (e) {
      if (e instanceof ProviderSkipped || e instanceof ProviderUnavailable || e instanceof BudgetExceeded) {
        skipped.push({ phase: 4, reason: describe(e) });
        incomplete = true;
        journal.write({ phase: 4, event: "skip", detail: describe(e) });
        log.warn(
          `Phase 4 skipped (${describe(e)}). The report will list explicitly what was not checked — ` +
            `absence of a security finding here is not evidence of security.`,
        );
      } else {
        throw e;
      }
    }
  } else {
    skipped.push({ phase: 4, reason: "excluded by --phases" });
    incomplete = true;
  }

  /* ───────── phase 5: adjudicate ───────── */
  let adjudications: ScanResult["adjudications"] = [];
  let gaps: ScanResult["gaps"] = [];
  let validationFailures: { gap_id: string; problems: string[] }[] = [];

  if (phases.has(5) && corpus.obligations.length) {
    journal.write({ phase: 5, event: "start" });
    try {
      const res = await runAdjudicate({
        cfg, paths, sov, providers, profile, evidence, adversary,
        obligations: corpus.obligations,
      });
      adjudications = res.adjudications;
      gaps = res.gaps;
      validationFailures = res.validation_failures;
      saveArtifact(paths, runId, "adjudication", { adjudications, gaps, validationFailures });
      journal.write({ phase: 5, event: "done", detail: `${gaps.length} gaps` });
      log.ok(`Phase 5 adjudication: ${adjudications.length} decision(s), ${gaps.length} gap(s)`);
      if (validationFailures.length) {
        log.warn(
          `${validationFailures.length} gap(s) had validator complaints; they are recorded in compliance/VALIDATION.md.`,
        );
      }
    } catch (e) {
      // §13 — Anthropic down → hard fail; phase 5 is the product. Same principle
      // under OpenRouter: without adjudication there is no report worth writing.
      if (e instanceof ProviderSkipped || e instanceof ProviderUnavailable) {
        throw new UserError(
          `Phase 5 could not run: ${describe(e)}`,
          `Adjudication is the product — a report with obligations and evidence but no judgement would be ` +
            `a list, not an audit. Partial artifacts from phases 0-4 have been written to ${paths.state}.`,
          4,
        );
      }
      throw e;
    }
  } else if (!corpus.obligations.length) {
    skipped.push({ phase: 5, reason: "no obligations were retrieved, so there was nothing to adjudicate" });
    incomplete = true;
    log.warn("Phase 5 skipped: no obligations were retrieved.");
  } else {
    skipped.push({ phase: 5, reason: "excluded by --phases" });
    incomplete = true;
  }

  /* ───────── assemble ───────── */
  const finished = Date.now();
  const spendBySeat = providers.meter.all() as unknown as Record<string, number>;
  const spendByPhase: Record<string, number> = {};
  let costReported = false;
  for (const rec of providers.meter.history()) {
    spendByPhase[rec.phase] = (spendByPhase[rec.phase] ?? 0) + rec.cost_usd;
    if (rec.cost_reported) costReported = true;
  }

  const meta: RunMeta = {
    run_id: runId,
    tool_version: BRAND.version,
    started_at: new Date(started).toISOString(),
    finished_at: nowIso(),
    duration_ms: finished - started,
    sovereignty_level: sov.level,
    regions: cfg.regions,
    models: {
      research: cfg.models.research,
      security: cfg.models.security,
      architect: cfg.models.architect,
    },
    phases_run: [...phases].filter((p) => !skipped.some((s) => s.phase === p)),
    phases_skipped: skipped,
    cost_usd: spendBySeat,
    prompt_hashes: allPromptHashes(),
    input_hash: hashObject({ files: redacted.map((f) => f.sealed_path), level: sov.level }),
    offline: opts.offline ?? false,
    corpus_stale: corpus.stale,
    incomplete,
    git_head: gitHead(paths.root),
  };

  const result: ScanResult = {
    meta,
    profile,
    obligations: corpus.obligations,
    excluded: corpus.excluded,
    disputed: corpus.disputed,
    evidence,
    adversary,
    adjudications,
    gaps,
  };

  /* ───────── phase 6: emit ───────── */
  journal.write({ phase: 6, event: "start" });
  const emitted = runEmit({
    cfg, paths, sov, result,
    harnesses,
    wallClockMs: finished - started,
    spendBySeat,
    spendByPhase,
    costReportedByVendor: costReported,
    formats: opts.formats,
    validationFailures,
  });
  journal.write({ phase: 6, event: "done", detail: `${emitted.files.length} files` });

  saveArtifact(paths, runId, "result", result);

  log.blank();
  log.ok(
    `Scan complete in ${humanDuration(meta.duration_ms)} — ${gaps.length} gap(s), ` +
      `$${Object.values(spendBySeat).reduce((a, b) => a + b, 0).toFixed(4)} spent.`,
  );
  if (incomplete) {
    log.warn(`This run is INCOMPLETE. Skipped: ${skipped.map((s) => `phase ${s.phase} (${s.reason})`).join("; ")}`);
  }

  return { result, files: emitted.files, incomplete };
}

/* ───────────────────────── dry run ───────────────────────── */

function dryRun(
  opts: ScanOptions,
  sov: Sovereignty,
  providers: Providers,
  redacted: RedactedFile[],
  runId: string,
  started: number,
): ScanOutcome {
  const totalChars = redacted.reduce((n, f) => n + f.content.length, 0);
  const estTokens = Math.ceil(totalChars / 3.6);
  const perPhase: { phase: number; seat: string; calls: number; tokens: number }[] = [
    { phase: 1, seat: "architect", calls: 1, tokens: 6000 },
    { phase: 2, seat: "research", calls: 40, tokens: 40 * 3000 },
    { phase: 4, seat: "security", calls: Math.max(1, Math.ceil(totalChars / 60_000)), tokens: estTokens },
    { phase: 5, seat: "architect", calls: 12, tokens: 12 * 6000 },
  ];

  log.blank();
  log.info("Projected spend (no calls made):");
  log.blank();
  log.info(`  ${"phase".padEnd(8)}${"seat".padEnd(12)}${"calls".padEnd(8)}${"~tokens".padEnd(12)}~cost`);
  let total = 0;
  for (const p of perPhase) {
    const client = providers.bySeat(p.seat as "research" | "security" | "architect");
    const cost = (p.tokens / 1_000_000) * 3 + (p.calls * 2000) / 1_000_000 * 15;
    total += cost;
    log.info(
      `  ${String(p.phase).padEnd(8)}${p.seat.padEnd(12)}${String(p.calls).padEnd(8)}` +
        `${String(p.tokens).padEnd(12)}$${cost.toFixed(3)}  (${client.modelId})`,
    );
  }
  log.blank();
  log.info(`  Projected total: $${total.toFixed(2)}`);
  log.info(
    `  These are rough upper bounds from local token estimates. Actual cost is reported per call by ` +
      `OpenRouter and metered live during a real run.`,
  );
  log.blank();
  log.info(`  ${redacted.length} file(s) would be sent, at sovereignty level ${sov.level}.`);
  log.info(`  Run \`${BRAND.name} sovereignty preview\` to see exactly what that means, per file.`);

  const meta: RunMeta = {
    run_id: runId,
    tool_version: BRAND.version,
    started_at: new Date(started).toISOString(),
    finished_at: nowIso(),
    duration_ms: Date.now() - started,
    sovereignty_level: sov.level,
    regions: opts.cfg.regions,
    models: opts.cfg.models,
    phases_run: [0],
    phases_skipped: [{ phase: -1, reason: "dry run: no model calls were made" }],
    cost_usd: {},
    prompt_hashes: allPromptHashes(),
    input_hash: hashObject(redacted.map((f) => f.sealed_path)),
    offline: true,
    corpus_stale: false,
    incomplete: true,
    git_head: gitHead(opts.paths.root),
  };

  return {
    result: {
      meta,
      profile: {} as ProjectProfile,
      obligations: [], excluded: [], disputed: [],
      evidence: {} as EvidenceBundle,
      adversary: [], adjudications: [], gaps: [],
    },
    files: [],
    incomplete: true,
  };
}

/* ───────────────────────── run artifacts ───────────────────────── */

function artifactPath(paths: Paths, runId: string, name: string): string {
  return `${paths.runs}/${runId}/${name}.json`;
}

function saveArtifact(paths: Paths, runId: string, name: string, value: unknown): void {
  writeJson(artifactPath(paths, runId, name), value);
}

function cachedArtifact<T>(paths: Paths, runId: string, name: string): T | null {
  const v = readJson<T | null>(artifactPath(paths, runId, name), null);
  return v;
}

/** Latest completed result, for `report`, `gaps`, `ledger`, `roi`, `diff`. */
export function loadLatestResult(paths: Paths): { runId: string; result: ScanResult } | null {
  const journal = new Journal(paths, "");
  const entries = journal.entries().filter((e) => e.phase === 6 && e.event === "done");
  for (let i = entries.length - 1; i >= 0; i--) {
    const runId = entries[i]!.run_id;
    const result = readJson<ScanResult | null>(artifactPath(paths, runId, "result"), null);
    if (result) return { runId, result };
  }
  return null;
}

export function loadResult(paths: Paths, runId: string): ScanResult | null {
  return readJson<ScanResult | null>(artifactPath(paths, runId, "result"), null);
}

function describe(e: unknown): string {
  if (e instanceof ProviderSkipped) return e.reason;
  if (e instanceof Error) return e.message;
  return String(e);
}
