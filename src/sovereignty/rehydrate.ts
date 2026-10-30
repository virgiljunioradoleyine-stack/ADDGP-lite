import type { PseudonymMap } from "./pseudonym.ts";

/**
 * §5.2 — findings come back referring to `mod_a7/svc_b3.ts:fn_112`; this maps
 * them to `src/billing/pricingEngine.ts:calculateEnterpriseTier()` locally,
 * before anything is written to the report.
 *
 * Replacement is longest-pseudonym-first so `fn_1` can never eat `fn_12`.
 */
export function rehydrate(text: string, map: PseudonymMap): string {
  if (!text) return text;
  const names = map.pseudonyms();
  if (!names.length) return text;

  let out = text;
  for (const p of names) {
    if (!out.includes(p)) continue;
    const real = map.real(p);
    if (real === null) continue;
    out = replaceTokenwise(out, p, real);
  }
  return out;
}

/**
 * Replace only whole tokens. `fn_a7` inside `xfn_a7z` is not a pseudonym.
 * Paths are handled because `/` and `.` are not identifier characters.
 */
function replaceTokenwise(haystack: string, needle: string, replacement: string): string {
  let out = "";
  let i = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, i);
    if (idx === -1) {
      out += haystack.slice(i);
      return out;
    }
    const before = idx === 0 ? "" : haystack[idx - 1]!;
    const afterIdx = idx + needle.length;
    const after = afterIdx >= haystack.length ? "" : haystack[afterIdx]!;
    const boundedBefore = !/[A-Za-z0-9_$]/.test(before);
    const boundedAfter = !/[A-Za-z0-9_$]/.test(after);
    out += haystack.slice(i, idx) + (boundedBefore && boundedAfter ? replacement : needle);
    i = afterIdx;
  }
}

/**
 * The inverse of rehydrate, for text that is about to leave again. Model output is
 * rehydrated as soon as it arrives so the user reads real names; when part of it is
 * then fed into a later prompt (the profile into phase 4, adversary findings into
 * phase 5) every real name the map knows must go back to its pseudonym, or the
 * second call would carry what the first one never saw. Longest name first, whole
 * tokens only. Names under three characters are left alone: they identify nothing
 * and would otherwise shred ordinary prose.
 */
export function reseal(text: string, map: PseudonymMap): string {
  if (!text) return text;
  const byReal = new Map<string, string>();
  for (const { pseudonym, real } of map.entries()) {
    if (real.length < 3 || real === pseudonym || byReal.has(real)) continue;
    byReal.set(real, pseudonym);
  }
  let out = text;
  for (const real of [...byReal.keys()].sort((a, b) => b.length - a.length)) {
    if (!out.includes(real)) continue;
    out = replaceTokenwise(out, real, byReal.get(real)!);
  }
  return out;
}

/** Deep-rehydrate every string in a structure returned by a model. */
export function rehydrateDeep<T>(value: T, map: PseudonymMap): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return rehydrate(v, map);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        // keys can carry pseudonyms too (e.g. a per-file map)
        out[rehydrate(k, map)] = walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

/** True when a string still contains anything that looks like an unmapped pseudonym. */
export function residualPseudonyms(text: string): string[] {
  const re = /\b(?:mod|dir|svc|fn|cls|v|tbl|col|term|rt)_[a-z0-9]{2,10}\b/g;
  return [...new Set(text.match(re) ?? [])];
}
