import type { Config } from "../config/index.ts";
import type { Paths } from "../util/paths.ts";
import { log } from "../util/log.ts";
import { nowIso, isStale } from "../util/time.ts";
import { renderPrompt } from "../util/prompts.ts";
import type { Sovereignty } from "../sovereignty/index.ts";
import { extractJson, ProviderSkipped, type Providers } from "../providers/index.ts";
import {
  FACETS, authorityAllowlist, facetById, getPack, hasPack, isPrimarySource,
  type Pack,
} from "../regions/index.ts";
import {
  ObligationSchema, type Citation, type ExcludedObligation, type Obligation,
  type ProjectProfile,
} from "../schemas/index.ts";

export interface CorpusOptions {
  cfg: Config;
  paths: Paths;
  sov: Sovereignty;
  providers: Providers;
  profile: ProjectProfile;
  /** cap the number of retrieval queries; the dry-run projection uses the same number */
  maxQueries?: number;
}

export interface CorpusResult {
  obligations: Obligation[];
  disputed: Obligation[];
  excluded: ExcludedObligation[];
  /** true when results came from cache past their TTL — the report banners this */
  stale: boolean;
  queries_run: number;
  trap_failures: number;
}

/* ───────────────────────── deterministic query planning ───────────────────────── */

export interface QueryPlanItem {
  region: string;
  facet: string;
  reason: string;
}

/**
 * §6.2 — deterministic query planning over regions × instruments × profile facets.
 * The plan is computed in code, not by a model, so two runs over the same profile
 * ask the same questions and the cache actually hits.
 */
export function planQueries(cfg: Config, profile: ProjectProfile): QueryPlanItem[] {
  const active = new Set<string>(["personal_data", "security_of_processing", "governance"]);
  const add = (facet: string) => active.add(facet);

  if (profile.data_categories.some((c) => c.special)) add("special_categories");
  if (profile.data_categories.some((c) => /child|minor|student|guardian/i.test(c.name))) add("children");
  if (profile.data_categories.some((c) => /biometric|fingerprint|face|iris|voice/i.test(c.name))) add("biometrics");
  if (profile.cross_border_flows.length) add("cross_border");
  if (profile.automated_decisions.length) add("automated_decisions");
  if (profile.automated_decisions.some((d) => d.legal_effect)) add("dpia");
  if (profile.ai_components.length) {
    add("ai_classification");
    add("cross_border");
  }
  if (profile.third_parties.length) add("processor_terms");
  // Always ask: these bite regardless of what the profile says, and a developer
  // who has not thought about them is exactly who this tool is for.
  add("breach_notification");
  add("retention");
  add("data_subject_rights");
  add("registration");
  add("ropa");
  add("consent_marketing");
  add("enforcement");

  const plan: QueryPlanItem[] = [];
  const packIds = [...cfg.regions, ...cfg.frameworks];
  for (const regionId of packIds) {
    if (!hasPack(regionId)) continue;
    const pack = getPack(regionId);
    for (const facet of FACETS) {
      if (!active.has(facet.id)) continue;
      // A framework pack only answers the facets it actually covers.
      if (pack.kind === "framework" && !pack.facet_hints[facet.id] && !pack.seed_obligations.some((s) => s.facets.includes(facet.id))) {
        continue;
      }
      plan.push({
        region: regionId,
        facet: facet.id,
        reason: pack.facet_hints[facet.id] ?? facet.description,
      });
    }
  }
  return plan;
}

/* ───────────────────────── retrieval ───────────────────────── */

interface RawObligation {
  instrument?: string;
  provision?: string;
  title?: string;
  obligation_text?: string;
  applies_when?: string[];
  testable_as?: string[];
  penalty?: {
    max?: { amount?: number; currency?: string; or_percent_turnover?: number | null } | null;
    description?: string | null;
    criminal?: boolean;
  } | null;
  deadline?: string | null;
  citations?: { title?: string; url?: string; publisher?: string; quote?: string }[];
  confidence?: number;
}

/** A provision that does not exist, injected per batch. §6.2 rule 3. */
function trapProvision(pack: Pack): { instrument: string; provision: string } {
  const instrument = pack.instruments[0]?.name ?? pack.name;
  // Deliberately absurd but plausibly-formatted, and stable per pack so the
  // cache does not mask a repeat failure.
  return { instrument, provision: "Section 419B(7)(c)" };
}

export async function runCorpus(opts: CorpusOptions): Promise<CorpusResult> {
  const { cfg, sov, providers, profile } = opts;
  const plan = planQueries(cfg, profile);
  const limit = opts.maxQueries ?? plan.length;
  const selected = plan.slice(0, limit);

  const obligations: Obligation[] = [];
  const disputed: Obligation[] = [];
  const excluded: ExcludedObligation[] = [];
  let queries = 0;
  let trapFailures = 0;
  let stale = false;

  for (const region of [...cfg.regions, ...cfg.frameworks]) {
    if (!hasPack(region)) {
      excluded.push({
        id: `${region}-nopack`,
        title: `Region "${region}"`,
        regime: region,
        reason:
          `No pack ships for "${region}", so it was not audited. The tool does not guess at a regime it has ` +
          `not been given sources for.`,
        reason_code: "region_not_selected",
      });
    }
  }

  const facetsByRegion = new Map<string, QueryPlanItem[]>();
  for (const item of selected) {
    if (!facetsByRegion.has(item.region)) facetsByRegion.set(item.region, []);
    facetsByRegion.get(item.region)!.push(item);
  }

  for (const [regionId, items] of facetsByRegion) {
    const pack = getPack(regionId);
    const allowlist = authorityAllowlist([regionId]);

    // §6.2 rule 3 — fabrication trap, once per region batch.
    const trapFailed = await runTrap(opts, pack);
    queries++;
    if (trapFailed) {
      trapFailures++;
      log.warn(
        `Fabrication trap fired for ${pack.name}: the research seat produced content for a provision that ` +
          `does not exist. Re-running this region under stricter instructions.`,
      );
      const secondTrap = await runTrap(opts, pack, true);
      queries++;
      if (secondTrap) {
        log.error(
          `Fabrication trap fired twice for ${pack.name}. Abandoning retrieval for this region rather than ` +
            `reporting law that may be invented.`,
        );
        for (const item of items) {
          excluded.push({
            id: `${regionId}-${item.facet}-trap`,
            title: `${pack.name} — ${item.facet}`,
            regime: pack.name,
            reason:
              `Retrieval for this region was abandoned: the fabrication trap fired twice, meaning the research ` +
              `seat produced content for a provision known not to exist. Reporting from this batch would risk ` +
              `hallucinated law.`,
            reason_code: "fabrication_suspected",
          });
        }
        continue;
      }
    }

    for (const item of items) {
      const facet = facetById(item.facet);
      if (!facet) continue;
      try {
        const raw = await retrieveFacet(opts, pack, item, allowlist);
        queries++;
        if (raw.stale) stale = true;

        for (const r of raw.obligations) {
          const built = buildObligation(r, pack, item.facet, allowlist);
          if (!built) {
            excluded.push({
              id: `${regionId}-${item.facet}-nosource-${excluded.length}`,
              title: r.title ?? r.provision ?? "(untitled)",
              regime: pack.name,
              reason:
                `Quarantined: no resolving primary source. An obligation without a live primary source is ` +
                `quarantined, not reported — hallucinated law is worse than no law.`,
              reason_code: "no_primary_source",
            });
            continue;
          }
          obligations.push(built);
        }
      } catch (e) {
        if (e instanceof ProviderSkipped) {
          log.warn(`Corpus retrieval skipped for ${pack.name}/${item.facet}: ${e.reason}`);
          excluded.push({
            id: `${regionId}-${item.facet}-skipped`,
            title: `${pack.name} — ${item.facet}`,
            regime: pack.name,
            reason: `Retrieval was skipped: ${e.reason}. This facet was NOT checked.`,
            reason_code: "no_primary_source",
          });
          continue;
        }
        throw e;
      }
    }
  }

  // §6.2 rule 2 — second-pass verification of every obligation.
  const verified: Obligation[] = [];
  for (const ob of obligations) {
    try {
      const verdict = await verifyObligation(opts, ob);
      queries++;
      if (verdict === "confirmed") {
        ob.verification = "double_sourced";
        ob.confidence = Math.min(1, ob.confidence + 0.1);
        verified.push(ob);
      } else if (verdict === "contradicted") {
        ob.verification = "disputed";
        disputed.push(ob);
      } else if (verdict === "not_found") {
        excluded.push({
          id: ob.id,
          title: ob.title,
          regime: ob.regime,
          reason:
            `Quarantined: second-pass verification could not find ${ob.provision} in ${ob.instrument}. ` +
            `A provision two independent retrievals cannot both locate is not reported as law.`,
          reason_code: "no_primary_source",
        });
      } else {
        ob.verification = "single_sourced";
        ob.confidence = Math.max(0, ob.confidence - 0.15);
        verified.push(ob);
      }
    } catch (e) {
      if (e instanceof ProviderSkipped) {
        ob.verification = "single_sourced";
        verified.push(ob);
        continue;
      }
      throw e;
    }
  }

  // §6.2 rule 4 — quote fidelity. A claimed verbatim quote must appear in the source.
  for (const ob of verified) {
    for (const c of ob.citations) {
      if (!c.quote) continue;
      const quoteOk = await checkQuote(opts, c);
      c.quote_verified = quoteOk;
      if (quoteOk === false) {
        ob.confidence = Math.max(0, ob.confidence - 0.2);
        log.debug(`Quote fidelity failed for ${ob.id} against ${c.url}`);
      }
    }
  }

  return {
    obligations: dedupeObligations(verified),
    disputed,
    excluded,
    stale,
    queries_run: queries,
    trap_failures: trapFailures,
  };
}

/* ───────────────────────── individual steps ───────────────────────── */

async function retrieveFacet(
  opts: CorpusOptions,
  pack: Pack,
  item: QueryPlanItem,
  allowlist: ReadonlySet<string>,
): Promise<{ obligations: RawObligation[]; stale: boolean }> {
  const facet = facetById(item.facet)!;
  const { system, user, version } = renderPrompt("02-corpus", {
    REGION_NAME: pack.name,
    REGION_ID: pack.id,
    INSTRUMENTS: pack.instruments.filter((i) => i.in_force).map((i) => `${i.name} (${i.url})`).join("; "),
    AUTHORITIES: [...allowlist].join(", "),
    FACET: item.facet,
    FACET_DESCRIPTION: item.reason || facet.description,
    PROFILE_FACTS: profileFacts(opts.profile),
  });

  const payload = opts.sov.sealText(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    `phase 2: ${pack.id}/${item.facet}`,
  );

  const res = await opts.providers.research.call(payload, {
    phase: 2,
    promptVersion: version,
    purpose: `corpus:${pack.id}:${item.facet}`,
    maxTokens: 6000,
    ttlDays: opts.cfg.cache.ttl_days.corpus,
  });

  const parsed = extractJson<RawObligation[]>(res.text);
  const list = Array.isArray(parsed) ? parsed : [];

  // Attach the provider's own citations when the model omitted them inline.
  if (res.citations.length) {
    for (const r of list) {
      if (!r.citations?.length) {
        r.citations = res.citations.map((c) => ({ url: c.url, title: c.title }));
      }
    }
  }
  return { obligations: list, stale: res.cached };
}

async function runTrap(opts: CorpusOptions, pack: Pack, strict = false): Promise<boolean> {
  const trap = trapProvision(pack);
  const { system, user, version } = renderPrompt("02-trap", {
    INSTRUMENT: trap.instrument,
    PROVISION: trap.provision,
    REGION_NAME: pack.name,
  });
  const payload = opts.sov.sealText(
    [
      {
        role: "system",
        content: strict
          ? system + "\n\nThis is a re-run after a suspected fabrication. Be maximally conservative."
          : system,
      },
      { role: "user", content: user },
    ],
    `phase 2: fabrication trap ${pack.id}`,
  );

  try {
    const res = await opts.providers.research.call(payload, {
      phase: 2,
      promptVersion: version,
      purpose: `trap:${pack.id}`,
      maxTokens: 800,
      // Never cache the trap: a cached "pass" would hide a live regression.
      ttlDays: 0,
      bypassCache: true,
      params: { strict },
    });
    const parsed = extractJson<{ exists?: boolean; obligation_text?: string | null }>(res.text);
    if (!parsed) return /\bexists\b|\brequires\b|\bsection\b/i.test(res.text) && !/does not exist|no such|not found|could not find/i.test(res.text);
    // The trap fires when the model claims the provision exists or invents text for it.
    return parsed.exists === true || (typeof parsed.obligation_text === "string" && parsed.obligation_text.trim().length > 0);
  } catch (e) {
    if (e instanceof ProviderSkipped) return false;
    throw e;
  }
}

type Verdict = "confirmed" | "contradicted" | "not_found" | "unclear";

async function verifyObligation(opts: CorpusOptions, ob: Obligation): Promise<Verdict> {
  const { system, user, version } = renderPrompt("02-verify", {
    INSTRUMENT: ob.instrument,
    PROVISION: ob.provision,
    REGION_NAME: ob.regime,
    OBLIGATION_TEXT: ob.obligation_text.slice(0, 1200),
    PENALTY: ob.penalty?.max
      ? `${ob.penalty.max.amount} ${ob.penalty.max.currency}`
      : (ob.penalty?.description ?? "none stated"),
  });

  const payload = opts.sov.sealText(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    `phase 2: verify ${ob.id}`,
  );

  const res = await opts.providers.research.call(payload, {
    phase: 2,
    promptVersion: version,
    purpose: `verify:${ob.id}`,
    maxTokens: 2500,
    ttlDays: opts.cfg.cache.ttl_days.corpus,
    // Independent re-query: must not read the first pass's cache entry.
    params: { pass: 2 },
  });

  const parsed = extractJson<{
    exists?: boolean;
    supports_claim?: boolean;
    verdict?: string;
    penalty_confirmed?: boolean;
    in_force?: boolean;
  }>(res.text);
  if (!parsed) return "unclear";

  if (parsed.verdict === "provision_not_found" || parsed.verdict === "instrument_not_found") return "not_found";
  if (parsed.exists === false) return "not_found";
  if (parsed.verdict === "contradicted" || parsed.supports_claim === false) return "contradicted";
  if (parsed.verdict === "confirmed") {
    // A confirmed obligation whose penalty was not confirmed loses the penalty,
    // rather than losing the obligation. §6.2 rule 6.
    if (parsed.penalty_confirmed === false && ob.penalty?.max) ob.penalty.max = null;
    return "confirmed";
  }
  return "unclear";
}

/**
 * §6.2 rule 4 — fetch the cited page and string-check the claimed quote.
 * Deliberately best-effort: a failure to fetch is not a failure of the quote,
 * and the distinction is preserved (undefined vs false).
 */
async function checkQuote(opts: CorpusOptions, c: Citation): Promise<boolean | undefined> {
  void opts;
  if (!c.quote || c.quote.length < 24) return undefined;
  try {
    const res = await fetch(c.url, {
      signal: AbortSignal.timeout(12_000),
      headers: { "user-agent": "addgp-lite quote-verification" },
    });
    if (!res.ok) return undefined;
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .toLowerCase();
    const needle = c.quote.replace(/\s+/g, " ").toLowerCase().trim();
    if (text.includes(needle)) return true;
    // Allow for ellipsis and minor formatting: check a distinctive middle run.
    const words = needle.split(" ").filter((w) => w.length > 3);
    if (words.length >= 6) {
      const probe = words.slice(2, 8).join(" ");
      if (text.includes(probe)) return true;
    }
    return false;
  } catch {
    return undefined;
  }
}

/* ───────────────────────── building and filtering ───────────────────────── */

function buildObligation(
  r: RawObligation,
  pack: Pack,
  facet: string,
  allowlist: ReadonlySet<string>,
): Obligation | null {
  if (!r.provision || !r.obligation_text) return null;

  const citations: Citation[] = (r.citations ?? [])
    .filter((c) => typeof c.url === "string" && /^https?:\/\//.test(c.url))
    .map((c) => ({
      title: c.title ?? r.instrument ?? pack.name,
      url: c.url!,
      publisher: c.publisher,
      primary: isPrimarySource(c.url!, allowlist),
      retrieved_at: nowIso(),
      quote: c.quote,
    }));

  // §0.4 — an obligation without a resolving primary source is quarantined.
  if (!citations.some((c) => c.primary)) return null;

  // §6.2 rule 6 — no invented penalties.
  let penalty: Obligation["penalty"] = null;
  if (r.penalty) {
    const max = r.penalty.max;
    const hasAmount = typeof max?.amount === "number" && max.amount > 0 && typeof max.currency === "string";
    penalty = {
      max: hasAmount
        ? {
            amount: max!.amount!,
            currency: max!.currency!.slice(0, 3).toUpperCase(),
            ...(typeof max!.or_percent_turnover === "number"
              ? { or_percent_turnover: max!.or_percent_turnover }
              : {}),
            citation: citations.find((c) => c.primary)!,
          }
        : null,
      description: r.penalty.description ?? null,
      criminal: r.penalty.criminal ?? false,
    };
  }

  const id = `${pack.id}-${slugify(r.provision)}`;
  const candidate = {
    id,
    regime: pack.name,
    region: pack.id,
    instrument: r.instrument ?? pack.instruments[0]?.name ?? pack.name,
    provision: r.provision,
    title: r.title ?? r.provision,
    obligation_text: r.obligation_text,
    applies_when: r.applies_when ?? [],
    testable_as: r.testable_as ?? [],
    penalty,
    deadline: r.deadline ?? null,
    citations,
    confidence: typeof r.confidence === "number" ? Math.max(0, Math.min(1, r.confidence)) : 0.6,
    verification: "single_sourced" as const,
    facets: [facet],
    source: "retrieved" as const,
    retrieved_at: nowIso(),
  };

  const parsed = ObligationSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

/** Same provision retrieved under several facets is one obligation, many facets. */
function dedupeObligations(list: Obligation[]): Obligation[] {
  const byKey = new Map<string, Obligation>();
  for (const ob of list) {
    const key = `${ob.region}|${ob.instrument}|${ob.provision}`.toLowerCase();
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, ob);
      continue;
    }
    existing.facets = [...new Set([...existing.facets, ...ob.facets])];
    existing.testable_as = [...new Set([...existing.testable_as, ...ob.testable_as])];
    existing.applies_when = [...new Set([...existing.applies_when, ...ob.applies_when])];
    for (const c of ob.citations) {
      if (!existing.citations.some((x) => x.url === c.url)) existing.citations.push(c);
    }
    if (ob.confidence > existing.confidence) existing.confidence = ob.confidence;
    if (!existing.penalty?.max && ob.penalty?.max) existing.penalty = ob.penalty;
  }
  return [...byKey.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function profileFacts(p: ProjectProfile): string {
  const lines = [
    `Summary: ${p.summary}`,
    `Roles: ${p.roles.join(", ") || "unclear"}`,
    `Data subjects: ${p.data_subjects.join(", ") || "unknown"}`,
    `Data categories: ${p.data_categories.map((c) => `${c.name}${c.special ? " [special]" : ""}`).join(", ") || "none identified"}`,
    `Processing purposes: ${p.processing_purposes.join(", ") || "unknown"}`,
    `Automated decisions with legal effect: ${p.automated_decisions.filter((d) => d.legal_effect).length}`,
    `AI components: ${p.ai_components.map((a) => a.description).join("; ") || "none"}`,
    `Cross-border flows: ${p.cross_border_flows.map((f) => `${f.from}→${f.to}`).join(", ") || "none identified"}`,
    `Third parties: ${p.third_parties.map((t) => t.name).join(", ") || "none identified"}`,
  ];
  return lines.join("\n");
}

/** Corpus freshness for the banner (§1.3, §6.2 rule 5). */
export function corpusIsStale(obligations: Obligation[], ttlDays: number): boolean {
  return obligations.some((o) => isStale(o.retrieved_at, ttlDays));
}
