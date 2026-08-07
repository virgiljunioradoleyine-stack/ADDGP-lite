import { existsSync } from "node:fs";
import type { Config } from "../config/index.ts";
import type { Paths } from "../util/paths.ts";
import { readText } from "../util/fswalk.ts";
import { readJson, writeJson } from "../util/paths.ts";
import { log, UserError } from "../util/log.ts";
import { renderPrompt } from "../util/prompts.ts";
import type { Sovereignty } from "../sovereignty/index.ts";
import type { Providers } from "../providers/index.ts";
import { extractJson, ProviderSkipped } from "../providers/index.ts";
import { getPack } from "../regions/index.ts";
import { ProjectProfileSchema, type EvidenceBundle, type ProjectProfile } from "../schemas/index.ts";

export interface ProfileOptions {
  cfg: Config;
  paths: Paths;
  sov: Sovereignty;
  providers: Providers;
  evidence: EvidenceBundle;
  /** answers to earlier questionnaires, reused rather than re-asked */
  answers?: Record<string, string>;
  interactive?: boolean;
}

export interface ProfileResult {
  profile: ProjectProfile;
  /** blocking contradictions stop the run before phase 2 spends money */
  blocked: boolean;
}

/**
 * Phase 1 — deterministic evidence first, locally, then the architect seat turns
 * it into a ProjectProfile.
 *
 * §6.1: contradiction detection is the highest-value moment in the tool, and it
 * happens before phase 2 spends anything.
 */
export async function runProfile(opts: ProfileOptions): Promise<ProfileResult> {
  const { cfg, paths, sov, providers, evidence } = opts;

  const description = readDescription(cfg, paths);
  const localFacts = summariseEvidence(evidence);
  const regions = cfg.regions
    .map((id) => {
      try {
        const p = getPack(id);
        return `${p.id} (${p.name}, ${p.kind})`;
      } catch {
        return `${id} (NO PACK SHIPPED — will not be audited)`;
      }
    })
    .join(", ");

  const { system, user, version } = renderPrompt("01-profile", {
    DESCRIPTION: description,
    REGIONS: regions,
    EVIDENCE: localFacts,
  });

  // The profile payload carries conclusions about the code, never the code.
  const payload = sov.sealText(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    "phase 1: project profile",
  );

  let profile: ProjectProfile;
  try {
    const res = await providers.architect.call(payload, {
      phase: 1,
      promptVersion: version,
      purpose: "profile",
      maxTokens: 6000,
      ttlDays: cfg.cache.ttl_days.evidence,
    });
    const parsed = extractJson<unknown>(res.text);
    if (!parsed) {
      throw new UserError(
        "The architect seat did not return usable JSON for the project profile.",
        "Re-run with --verbose to see the response, or try a different architect model in your config.",
      );
    }
    const rehydrated = sov.rehydrate(parsed);
    const check = ProjectProfileSchema.safeParse(rehydrated);
    if (!check.success) {
      log.debug(`profile schema issues: ${check.error.issues.map((i) => i.path.join(".")).join(", ")}`);
      profile = coerceProfile(rehydrated, evidence);
    } else {
      profile = check.data;
    }
  } catch (e) {
    if (e instanceof ProviderSkipped) {
      log.warn(`Phase 1 degraded: ${e.reason}. Using the deterministic profile only.`);
      profile = deterministicProfile(evidence, cfg);
    } else {
      throw e;
    }
  }

  // Deterministic facts always win over the model's recollection of them.
  profile.languages = Object.keys(evidence.languages).sort();
  profile.frameworks = evidence.frameworks;
  profile.data_stores = evidence.data_stores;

  profile.contradictions = [
    ...profile.contradictions,
    ...deterministicContradictions(description, evidence),
  ];

  const answers = opts.answers ?? readJson<Record<string, string>>(paths.answers, {});
  profile.open_questions = profile.open_questions
    .filter((q) => !answers[q.id])
    .slice(0, 8);

  const blocking = profile.contradictions.filter((c) => c.severity === "blocking");
  return { profile, blocked: blocking.length > 0 };
}

function readDescription(cfg: Config, paths: Paths): string {
  const file = cfg.project.description_file.startsWith("/")
    ? cfg.project.description_file
    : `${paths.root}/${cfg.project.description_file}`;
  const text = existsSync(file) ? readText(file, ".md") : null;
  if (!text || !text.trim()) {
    throw new UserError(
      `No project description found at ${cfg.project.description_file}.`,
      `Write a paragraph or two describing what the system does and what data it touches, then re-run. ` +
        `\`addgp-lite init\` creates this file for you.`,
    );
  }
  return text.trim();
}

/**
 * The conclusions phase 3 reached, expressed as facts — never as quoted code.
 * This is the §5.6 architectural trick made concrete.
 */
export function summariseEvidence(e: EvidenceBundle): string {
  const lines: string[] = [];
  lines.push(`Files scanned: ${e.file_count} (${e.loc} lines)`);
  lines.push(`Languages: ${Object.entries(e.languages).map(([l, n]) => `${l} (${n} lines)`).join(", ") || "none detected"}`);
  lines.push(`Frameworks: ${e.frameworks.join(", ") || "none detected"}`);
  lines.push(`Data stores: ${e.data_stores.join(", ") || "none detected"}`);
  lines.push("");

  const byKind = new Map<string, typeof e.findings>();
  for (const f of e.findings) {
    if (!byKind.has(f.kind)) byKind.set(f.kind, []);
    byKind.get(f.kind)!.push(f);
  }

  const order = [
    "pii_symbol", "storage", "ai_call_site", "crossborder", "logging", "secret",
    "iac_misconfig", "dependency_vuln", "auth", "retention", "data_flow",
    "artifact_absent", "artifact_present", "license",
  ];
  for (const kind of order) {
    const items = byKind.get(kind);
    if (!items?.length) continue;
    lines.push(`## ${kind} (${items.length})`);
    for (const f of items.slice(0, 40)) {
      lines.push(`- [${f.id}] ${f.severity.toUpperCase()} ${f.file}:${f.line} — ${f.conclusion}`);
    }
    if (items.length > 40) lines.push(`- …and ${items.length - 40} more of this kind`);
    lines.push("");
  }

  const present = Object.entries(e.compliance_artifacts).filter(([, v]) => v).map(([k]) => k);
  const absent = Object.entries(e.compliance_artifacts).filter(([, v]) => !v).map(([k]) => k);
  lines.push(`Compliance artifacts present: ${present.join(", ") || "none"}`);
  lines.push(`Compliance artifacts absent: ${absent.join(", ") || "none"}`);
  return lines.join("\n");
}

/**
 * Contradictions we can prove without a model. These are the cheapest and the
 * most convincing: a claim in the description against a fact in the code.
 */
function deterministicContradictions(
  description: string,
  e: EvidenceBundle,
): ProjectProfile["contradictions"] {
  const out: ProjectProfile["contradictions"] = [];
  const desc = description.toLowerCase();
  let n = 0;
  const id = () => `DC${++n}`;

  const piiFindings = e.findings.filter((f) => f.kind === "pii_symbol");
  const specialFindings = piiFindings.filter((f) => f.meta?.special === true);

  const claimsNoPersonalData =
    /\b(?:no|not|don'?t|do not|never)\b[^.]{0,60}\b(?:personal data|pii|personal information|user data|collect)\b/.test(desc) ||
    /\b(?:anonymous|anonymised|anonymized)\b[^.]{0,40}\bonly\b/.test(desc);
  if (claimsNoPersonalData && piiFindings.length > 0) {
    out.push({
      id: id(),
      claim: "The description states that the system does not handle personal data.",
      evidence: `Phase 3 found ${piiFindings.length} personal-data symbol(s), for example ${piiFindings[0]!.file}:${piiFindings[0]!.line} (${String(piiFindings[0]!.meta?.category ?? "personal data")}).`,
      severity: "blocking",
      question:
        "Does this system store or transmit data about identifiable people? If those fields are test data only, say so and the scan will treat them as such.",
    });
  }

  const claimsNoSensitive = /\b(?:no|not|don'?t|never)\b[^.]{0,60}\b(?:sensitive|special category|biometric|health)\b/.test(desc);
  if (claimsNoSensitive && specialFindings.length > 0) {
    out.push({
      id: id(),
      claim: "The description states that no sensitive or special-category data is handled.",
      evidence: `Phase 3 found ${specialFindings.length} special-category symbol(s), for example ${String(specialFindings[0]!.meta?.category)} at ${specialFindings[0]!.file}:${specialFindings[0]!.line}.`,
      severity: "blocking",
      question: "Which of these fields actually hold special-category data in production?",
    });
  }

  const claimsNoAi = /\b(?:no|not|don'?t|never)\b[^.]{0,40}\b(?:ai|llm|model|machine learning)\b/.test(desc);
  const aiFindings = e.findings.filter((f) => f.kind === "ai_call_site");
  if (claimsNoAi && aiFindings.length > 0) {
    out.push({
      id: id(),
      claim: "The description states that the system does not use AI or a language model.",
      evidence: `Phase 3 found ${aiFindings.length} inference call site(s), for example ${aiFindings[0]!.file}:${aiFindings[0]!.line}.`,
      severity: "blocking",
      question: "Which inference vendors does this system call, and with what data?",
    });
  }

  const claimsNoThirdParty = /\b(?:no|not|don'?t|never)\b[^.]{0,50}\b(?:third[- ]part|share|external service|vendor)\b/.test(desc);
  const crossborder = e.findings.filter((f) => f.kind === "crossborder");
  if (claimsNoThirdParty && crossborder.length > 0) {
    out.push({
      id: id(),
      claim: "The description states that no data is shared with third parties.",
      evidence: `Phase 3 found ${crossborder.length} outbound third-party call site(s), for example ${crossborder[0]!.file}:${crossborder[0]!.line}.`,
      severity: "warning",
      question: "Do any of those outbound calls carry personal data?",
    });
  }

  const claimsEncrypted = /\b(?:encrypt|encrypted|encryption)\b/.test(desc);
  const plainSpecial = e.findings.filter((f) => f.rule_id === "storage.special_category_column");
  if (claimsEncrypted && plainSpecial.length > 0) {
    out.push({
      id: id(),
      claim: "The description asserts that data is encrypted.",
      evidence: `Phase 3 found ${plainSpecial.length} special-category column(s) declared with an unencrypted column type, for example ${plainSpecial[0]!.file}:${plainSpecial[0]!.line}.`,
      severity: "warning",
      question:
        "Is encryption applied at the storage layer (disk/volume) rather than the column? Both are valid answers, but they satisfy different obligations.",
    });
  }

  const claimsDeletion = /\b(?:delete|deletion|erasure|remove your data|right to be forgotten)\b/.test(desc);
  const hasDeletion = e.findings.some((f) => f.rule_id === "retention.deletion_path");
  if (claimsDeletion && !hasDeletion) {
    out.push({
      id: id(),
      claim: "The description says users can delete their data.",
      evidence: "Phase 3 found no deletion, purge, or anonymisation path in the scanned code.",
      severity: "warning",
      question: "Where is deletion implemented — is it a manual database operation rather than a code path?",
    });
  }

  return out;
}

/** Fallback when the architect seat is unavailable: a profile from facts alone. */
function deterministicProfile(e: EvidenceBundle, cfg: Config): ProjectProfile {
  const categories = new Map<string, boolean>();
  for (const f of e.findings) {
    if (f.kind !== "pii_symbol") continue;
    const name = String(f.meta?.category ?? "");
    if (name) categories.set(name, f.meta?.special === true);
  }
  return ProjectProfileSchema.parse({
    summary:
      `Deterministic profile only: the architect seat was unavailable, so this describes what the local ` +
      `scanner observed and nothing more. ${e.file_count} files, ${e.frameworks.join(", ") || "no framework detected"}.`,
    roles: ["unclear"],
    data_subjects: [],
    data_categories: [...categories].map(([name, special]) => ({ name, special, evidence: [] })),
    processing_purposes: [],
    automated_decisions: [],
    ai_components: e.findings
      .filter((f) => f.kind === "ai_call_site")
      .map((f) => ({ description: f.conclusion, role: "unclear", evidence: [`${f.file}:${f.line}`] })),
    cross_border_flows: [],
    third_parties: [],
    security_posture: [],
    contradictions: [],
    open_questions: [],
    languages: Object.keys(e.languages),
    frameworks: e.frameworks,
    data_stores: e.data_stores,
  });
}

/** Salvage a partial profile rather than failing the run on one bad field. */
function coerceProfile(raw: unknown, e: EvidenceBundle): ProjectProfile {
  const base = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const arr = (k: string) => (Array.isArray(base[k]) ? (base[k] as unknown[]) : []);
  const merged = {
    summary: typeof base.summary === "string" ? base.summary : "No summary returned.",
    roles: arr("roles").filter((r) => typeof r === "string"),
    data_subjects: arr("data_subjects").filter((r) => typeof r === "string"),
    data_categories: arr("data_categories"),
    processing_purposes: arr("processing_purposes").filter((r) => typeof r === "string"),
    automated_decisions: arr("automated_decisions"),
    ai_components: arr("ai_components"),
    cross_border_flows: arr("cross_border_flows"),
    third_parties: arr("third_parties"),
    security_posture: arr("security_posture").filter((r) => typeof r === "string"),
    contradictions: arr("contradictions"),
    open_questions: arr("open_questions"),
    languages: Object.keys(e.languages),
    frameworks: e.frameworks,
    data_stores: e.data_stores,
    deployment: arr("deployment").filter((r) => typeof r === "string"),
  };
  const parsed = ProjectProfileSchema.safeParse(merged);
  if (parsed.success) return parsed.data;
  // Last resort: keep the summary, drop the malformed structure.
  const fallback = deterministicProfile(e, {} as Config);
  fallback.summary = merged.summary;
  return fallback;
}

export function saveAnswers(paths: Paths, answers: Record<string, string>): void {
  const existing = readJson<Record<string, string>>(paths.answers, {});
  writeJson(paths.answers, { ...existing, ...answers }, true);
}
