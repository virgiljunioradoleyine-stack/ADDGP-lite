import { z } from "zod";
import { PACKS } from "../generated/embedded.ts";
import { UserError } from "../util/log.ts";

export const InstrumentSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["act", "regulation", "directive", "treaty", "standard", "guidance"]),
  in_force: z.boolean(),
  sector: z.string().optional(),
  url: z.string().url(),
});
export type Instrument = z.infer<typeof InstrumentSchema>;

export const SeedObligationSchema = z.object({
  id: z.string(),
  provision: z.string(),
  title: z.string(),
  facets: z.array(z.string()),
  applies_when: z.array(z.string()),
  testable_as: z.array(z.string()),
  note: z.string().optional(),
});
export type SeedObligation = z.infer<typeof SeedObligationSchema>;

export const PackSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["region", "framework"]),
  depth: z.enum(["deep", "standard"]),
  currency: z.string(),
  regulator: z.object({ name: z.string(), url: z.string().url() }),
  /** hosts that count as a primary source for this regime (anti-hallucination §6.2.1) */
  authorities: z.array(z.string()).min(1),
  instruments: z.array(InstrumentSchema).min(1),
  facet_hints: z.record(z.string()).default({}),
  seed_obligations: z.array(SeedObligationSchema).default([]),
  notes: z.string().optional(),
});
export type Pack = z.infer<typeof PackSchema>;

const cache = new Map<string, Pack>();

export function listPackIds(): string[] {
  return Object.keys(PACKS).sort();
}

export function getPack(id: string): Pack {
  const cached = cache.get(id);
  if (cached) return cached;
  const raw = PACKS[id];
  if (!raw) {
    throw new UserError(
      `No pack shipped for "${id}".`,
      `Available: ${listPackIds().join(", ")}. A regime with no shipped pack is not audited — the tool says so plainly rather than guessing.`,
    );
  }
  const parsed = PackSchema.safeParse(raw);
  if (!parsed.success) {
    throw new UserError(
      `Pack "${id}" is malformed: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  cache.set(id, parsed.data);
  return parsed.data;
}

export function allPacks(): Pack[] {
  return listPackIds().map(getPack);
}

export function regionPacks(): Pack[] {
  return allPacks().filter((p) => p.kind === "region");
}

export function frameworkPacks(): Pack[] {
  return allPacks().filter((p) => p.kind === "framework");
}

export function hasPack(id: string): boolean {
  return id in PACKS;
}

/** Every host that counts as a primary source across the selected packs. */
export function authorityAllowlist(ids: readonly string[]): Set<string> {
  const hosts = new Set<string>();
  for (const id of ids) {
    if (!hasPack(id)) continue;
    for (const h of getPack(id).authorities) hosts.add(h.toLowerCase());
  }
  return hosts;
}

/**
 * Recognised legal publishers. Commentary from these may SUPPORT an obligation
 * but never establish one — §6.2 rule 1. Kept small on purpose.
 */
export const RECOGNISED_PUBLISHERS = new Set([
  "eur-lex.europa.eu",
  "legislation.gov.uk",
  "ecfr.gov",
  "govinfo.gov",
  "congress.gov",
  "kenyalaw.org",
  "saflii.org",
  "bailii.org",
  "planalto.gov.br",
  "indiacode.nic.in",
  "placng.org",
  "lawsofnigeria.placng.org",
  "ghanalegal.com",
  "un.org",
  "au.int",
  "iso.org",
  "nist.gov",
  "owasp.org",
  "genai.owasp.org",
  "pcisecuritystandards.org",
]);

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * §0.4 / §6.2 — a citation resolves as primary when its host is on the pack's
 * authority allowlist or is a recognised legal publisher. Everything else is
 * commentary.
 */
export function isPrimarySource(url: string, allowlist: ReadonlySet<string>): boolean {
  const host = hostOf(url);
  if (!host) return false;
  if (RECOGNISED_PUBLISHERS.has(host)) return true;
  for (const authority of allowlist) {
    if (host === authority || host.endsWith("." + authority)) return true;
  }
  return false;
}

/** The facets phase 2 plans queries over (§6.2). */
export const FACETS: { id: string; description: string }[] = [
  { id: "personal_data", description: "processing of personal data generally: principles, lawful bases, transparency" },
  { id: "special_categories", description: "special or sensitive categories of personal data, including national identifiers and biometrics" },
  { id: "children", description: "personal data of children, age assurance, and parental consent" },
  { id: "biometrics", description: "biometric identification and verification" },
  { id: "cross_border", description: "transfer of personal data outside the jurisdiction" },
  { id: "automated_decisions", description: "automated decision-making and profiling with legal or significant effects" },
  { id: "ai_classification", description: "classification and obligations for AI systems, by risk class and by operator role" },
  { id: "breach_notification", description: "personal data breach and cyber incident notification duties and deadlines" },
  { id: "registration", description: "registration, licensing, or filing with the regulator" },
  { id: "dpia", description: "impact assessments and prior consultation triggers" },
  { id: "retention", description: "storage limitation, retention periods and deletion" },
  { id: "security_of_processing", description: "technical and organisational security measures" },
  { id: "ropa", description: "records of processing activities and documentation duties" },
  { id: "processor_terms", description: "mandatory contract terms with processors and sub-processors" },
  { id: "consent_marketing", description: "consent, direct marketing and electronic communications" },
  { id: "data_subject_rights", description: "access, correction, deletion, portability, objection and their deadlines" },
  { id: "dpo", description: "data protection officer or equivalent designation duties" },
  { id: "governance", description: "accountability, policies, roles and scope determinations" },
  { id: "enforcement", description: "published enforcement decisions and penalty practice for comparable failures" },
];

export function facetById(id: string): { id: string; description: string } | undefined {
  return FACETS.find((f) => f.id === id);
}
