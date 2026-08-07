import { existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Config } from "../config/index.ts";
import type { Paths } from "../util/paths.ts";
import { readText, walk } from "../util/fswalk.ts";
import { writeOut } from "../util/paths.ts";
import { log, UserError } from "../util/log.ts";
import { renderPrompt } from "../util/prompts.ts";
import type { RedactedFile, Sovereignty } from "../sovereignty/index.ts";
import { extractJson, ProviderSkipped, type Providers } from "../providers/index.ts";
import { summariseEvidence } from "./p1-profile.ts";
import {
  AdversaryFindingSchema, type AdversaryFinding, type EvidenceBundle, type ProjectProfile,
} from "../schemas/index.ts";

export interface AdversaryOptions {
  cfg: Config;
  paths: Paths;
  sov: Sovereignty;
  providers: Providers;
  profile: ProjectProfile;
  evidence: EvidenceBundle;
  /** files already redacted by phase 0 */
  files: RedactedFile[];
  /** generate stress harnesses to disk (never executed) */
  stress?: boolean;
  concurrency?: number;
}

export interface AdversaryResult {
  findings: AdversaryFinding[];
  harnesses: StressHarness[];
  batches: number;
  skipped: string | null;
}

export interface StressHarness {
  filename: string;
  tool: string;
  target_path: string;
  legal_question: string;
  pass_criteria: string;
  content: string;
}

/** Bundle size per call. Large enough for cross-file reasoning, small enough to stay cheap. */
const BATCH_CHARS = 60_000;

/**
 * Phase 4 — attack, stress, audit. Runs over SEALED evidence bundles only:
 * this seat never sees an identifier, and everything it reports comes back
 * through the rehydrator before the user reads it.
 */
export async function runAdversary(opts: AdversaryOptions): Promise<AdversaryResult> {
  const { cfg, sov, providers, profile, evidence, files } = opts;
  const batches = batchFiles(files, BATCH_CHARS);
  const findings: AdversaryFinding[] = [];
  let counter = 0;

  const evidenceSummary = summariseEvidence(evidence);
  const profileText = JSON.stringify(
    {
      summary: profile.summary,
      roles: profile.roles,
      data_categories: profile.data_categories,
      ai_components: profile.ai_components,
      automated_decisions: profile.automated_decisions,
      cross_border_flows: profile.cross_border_flows,
      third_parties: profile.third_parties,
    },
    null,
    2,
  );

  for (const [i, batch] of batches.entries()) {
    const { system, user, version } = renderPrompt("04-adversary", {
      PROFILE: profileText,
      EVIDENCE: evidenceSummary,
      CODE: batch.text,
    });

    const payload = sov.sealCode(system, user, batch.files, `phase 4: adversary batch ${i + 1}/${batches.length}`);

    try {
      const res = await providers.security.call(payload, {
        phase: 4,
        promptVersion: version,
        purpose: `adversary:batch-${i + 1}`,
        maxTokens: 8000,
        ttlDays: cfg.cache.ttl_days.adversary,
      });

      const parsed = extractJson<unknown[]>(res.text);
      if (!Array.isArray(parsed)) {
        log.debug(`adversary batch ${i + 1} returned no usable JSON array`);
        continue;
      }
      for (const raw of parsed) {
        const built = buildFinding(raw, () => `ADV-${String(++counter).padStart(3, "0")}`);
        if (built) findings.push(built);
      }
    } catch (e) {
      if (e instanceof ProviderSkipped) {
        log.warn(`Phase 4 stopped after ${i} batch(es): ${e.reason}.`);
        return {
          findings: reconcile(sov.rehydrate(findings), evidence),
          harnesses: [],
          batches: i,
          skipped: e.reason,
        };
      }
      throw e;
    }
  }

  const rehydrated = sov.rehydrate(findings);
  const reconciled = reconcile(rehydrated, evidence);

  let harnesses: StressHarness[] = [];
  if (opts.stress !== false) {
    harnesses = await generateHarnesses(opts, reconciled);
  }

  return { findings: reconciled, harnesses, batches: batches.length, skipped: null };
}

function batchFiles(files: RedactedFile[], maxChars: number): { files: RedactedFile[]; text: string }[] {
  const batches: { files: RedactedFile[]; text: string }[] = [];
  let current: RedactedFile[] = [];
  let size = 0;
  for (const f of files) {
    const len = f.content.length + f.sealed_path.length + 64;
    if (size + len > maxChars && current.length) {
      batches.push({ files: current, text: renderBatch(current) });
      current = [];
      size = 0;
    }
    current.push(f);
    size += len;
  }
  if (current.length) batches.push({ files: current, text: renderBatch(current) });
  return batches;
}

function renderBatch(files: RedactedFile[]): string {
  return files.map((f) => `--- ${f.sealed_path} ---\n${f.content.trimEnd()}`).join("\n\n");
}

function buildFinding(raw: unknown, nextId: () => string): AdversaryFinding | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const candidate = {
    id: nextId(),
    title: String(r.title ?? "").slice(0, 300),
    category: r.category,
    severity: r.severity,
    owasp_llm: typeof r.owasp_llm === "string" ? r.owasp_llm : null,
    cwe: typeof r.cwe === "string" ? r.cwe : null,
    location: String(r.location ?? "(unspecified)"),
    condition: String(r.condition ?? ""),
    impact: String(r.impact ?? ""),
    confirmation_steps: Array.isArray(r.confirmation_steps) ? r.confirmation_steps.map(String) : [],
    status: "unconfirmed" as const,
    evidence_anchors: Array.isArray(r.evidence_anchors) ? r.evidence_anchors.map(String) : [],
  };
  const parsed = AdversaryFindingSchema.safeParse(candidate);
  if (!parsed.success) return null;
  if (!parsed.data.title || !parsed.data.impact) return null;
  return parsed.data;
}

/**
 * §6.4 reconciliation — a phase-4 finding with no phase-3 anchor is downgraded to
 * `unconfirmed` and labelled; a phase-3 finding that phase 4 explains gets its
 * severity refined upward.
 */
function reconcile(findings: AdversaryFinding[], evidence: EvidenceBundle): AdversaryFinding[] {
  const byId = new Map(evidence.findings.map((f) => [f.id, f]));
  const byFile = new Map<string, typeof evidence.findings>();
  for (const f of evidence.findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file)!.push(f);
  }

  for (const adv of findings) {
    const anchors = adv.evidence_anchors.filter((a) => byId.has(a));
    // A location that matches a file phase 3 actually saw counts as an anchor too.
    const locFile = adv.location.split(":")[0] ?? "";
    const fileAnchors = (byFile.get(locFile) ?? []).map((f) => f.id);
    const all = [...new Set([...anchors, ...fileAnchors])];

    adv.evidence_anchors = all;
    adv.status = all.length > 0 ? "confirmed" : "unconfirmed";

    if (adv.status === "unconfirmed") {
      adv.impact =
        `${adv.impact} [Unconfirmed: no local evidence anchors this finding to a file the scanner read, ` +
        `so it may be an inference from structure rather than an observed condition.]`;
      // An unconfirmed finding may not carry a critical rating into the report.
      if (adv.severity === "critical") adv.severity = "high";
    }
  }

  return findings.sort((a, b) => {
    const rank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    return rank[a.severity] - rank[b.severity];
  });
}

/* ───────────────────────── stress harnesses ───────────────────────── */

async function generateHarnesses(
  opts: AdversaryOptions,
  findings: AdversaryFinding[],
): Promise<StressHarness[]> {
  const { system, user, version } = renderPrompt("04-stress", {
    PROFILE: JSON.stringify(
      { summary: opts.profile.summary, data_categories: opts.profile.data_categories },
      null,
      2,
    ),
    FINDINGS: findings
      .slice(0, 25)
      .map((f) => `- ${f.id} [${f.severity}] ${f.title} @ ${f.location}`)
      .join("\n"),
  });

  const payload = opts.sov.sealText(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    "phase 4: stress harness generation",
  );

  try {
    const res = await opts.providers.security.call(payload, {
      phase: 4,
      promptVersion: version,
      purpose: "stress-harnesses",
      maxTokens: 8000,
      ttlDays: opts.cfg.cache.ttl_days.adversary,
    });
    const parsed = extractJson<unknown[]>(res.text);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((raw) => {
        const r = raw as Record<string, unknown>;
        if (typeof r.filename !== "string" || typeof r.content !== "string") return null;
        return {
          filename: safeFilename(r.filename),
          tool: String(r.tool ?? "shell"),
          target_path: String(r.target_path ?? ""),
          legal_question: String(r.legal_question ?? ""),
          pass_criteria: String(r.pass_criteria ?? ""),
          content: opts.sov.rehydrateText(r.content),
        } satisfies StressHarness;
      })
      .filter((h): h is StressHarness => h !== null);
  } catch (e) {
    if (e instanceof ProviderSkipped) return [];
    throw e;
  }
}

function safeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "harness.txt";
}

/**
 * §6.4 — harnesses are written to disk, not executed. The header states the
 * authorisation requirement so the file carries it even if it is copied away.
 */
export function writeHarnesses(paths: Paths, harnesses: StressHarness[]): string[] {
  const written: string[] = [];
  for (const h of harnesses) {
    const header =
      `# ${h.filename}\n` +
      `# Generated by addgp-lite. NOT executed by the tool.\n` +
      `#\n` +
      `# Legal question this exercises: ${h.legal_question}\n` +
      `# Passes when: ${h.pass_criteria}\n` +
      `#\n` +
      `# Run this ONLY against infrastructure you are authorised to test. The default target is\n` +
      `# localhost. \`addgp-lite stress run --target <url>\` will refuse any host that is not listed\n` +
      `# in a signed authorization.yaml at the repository root.\n\n`;
    const file = join(paths.outStress, h.filename);
    writeOut(file, header + h.content);
    written.push(file);
  }
  return written;
}

/* ───────────────────────── authorization gate ───────────────────────── */

export interface Authorization {
  targets: { url: string; environment?: string; attested_by?: string; date?: string }[];
}

/**
 * §6.4 authorization gate. A target must be named in a signed authorization.yaml
 * with a named attestation; production requires a second typed confirmation.
 * Never run against a host not in that file.
 */
export function checkAuthorization(
  paths: Paths,
  target: string,
): { allowed: boolean; reason: string; production: boolean } {
  let host: string;
  try {
    host = new URL(target).host;
  } catch {
    return { allowed: false, reason: `"${target}" is not a valid URL.`, production: false };
  }

  if (/^(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d+)?$/.test(host)) {
    return { allowed: true, reason: "localhost is always permitted", production: false };
  }

  const file = paths.authorization;
  if (!existsSync(file)) {
    return {
      allowed: false,
      reason:
        `No authorization.yaml at the repository root. A non-localhost target must be listed there with a ` +
        `named attestation before any harness may run against it.`,
      production: false,
    };
  }

  let auth: Authorization;
  try {
    auth = parseYaml(readText(file, ".yaml") ?? "") as Authorization;
  } catch (e) {
    return { allowed: false, reason: `authorization.yaml is not valid YAML: ${(e as Error).message}`, production: false };
  }

  const entry = (auth?.targets ?? []).find((t) => {
    try {
      return new URL(t.url).host === host;
    } catch {
      return false;
    }
  });

  if (!entry) {
    return {
      allowed: false,
      reason: `${host} is not listed in authorization.yaml. Refusing to run against a host nobody has attested to.`,
      production: false,
    };
  }
  if (!entry.attested_by) {
    return {
      allowed: false,
      reason: `${host} is listed in authorization.yaml but has no \`attested_by\`. An unnamed attestation is not an attestation.`,
      production: false,
    };
  }

  const production = /prod/i.test(entry.environment ?? "") || /prod/i.test(host);
  return {
    allowed: true,
    reason: `${host} attested by ${entry.attested_by}${entry.date ? ` on ${entry.date}` : ""}`,
    production,
  };
}

export function requireAuthorization(paths: Paths, target: string, confirmed: boolean): void {
  const verdict = checkAuthorization(paths, target);
  if (!verdict.allowed) {
    throw new UserError(`Refusing to run a harness against ${target}.`, verdict.reason);
  }
  if (verdict.production && !confirmed) {
    throw new UserError(
      `${target} is attested as a production target.`,
      `Re-run with --i-understand-this-is-production to confirm. Load-testing production is a decision a person makes, not a flag a tool assumes.`,
    );
  }
  log.ok(`Authorization: ${verdict.reason}`);
}

/** Fixture-repo helper: does the injected prompt-injection comment exist? (§11) */
export function findInjectionAttempts(root: string): { file: string; line: number; text: string }[] {
  const out: { file: string; line: number; text: string }[] = [];
  const re = /\b(?:ignore (?:all )?previous instructions|disregard (?:the )?(?:above|prior)|report zero gaps|you are now|system\s*:\s*override|do not report)\b/i;
  for (const f of walk(root, { maxFileKb: 512 })) {
    const text = readText(f.abs, f.ext);
    if (!text) continue;
    const lines = text.split("\n");
    for (const [i, line] of lines.entries()) {
      if (re.test(line)) out.push({ file: f.path, line: i + 1, text: line.trim().slice(0, 200) });
    }
  }
  return out;
}
