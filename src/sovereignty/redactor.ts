import { lex, langForExt, type Lang, type Token } from "./lexer.ts";
import { isAllowed } from "./allowlist.ts";
import { PseudonymMap, type SymbolKind } from "./pseudonym.ts";
import { findSecrets, findPii, type DetectorHit } from "./secrets.ts";

export type Level = 0 | 1 | 2;

export interface RedactOptions {
  level: Level;
  keepComments: boolean;
  /** company / product / customer names to tokenise (§5.1) */
  terms: readonly string[];
  /** dependency names, which are public facts and pass through unchanged */
  deps: ReadonlySet<string>;
  map: PseudonymMap;
  /** numeric constants at or above this are bucketed */
  numberThreshold?: number;
}

export interface RedactStats {
  identifiers_mapped: number;
  literals_placeheld: number;
  literals_dropped: number;
  comments_stripped: number;
  numbers_bucketed: number;
  terms_tokenised: number;
}

export interface RedactedFile {
  real_path: string;
  sealed_path: string;
  lang: Lang;
  level: Level;
  content: string;
  stats: RedactStats;
  /** secrets found and removed before anything could be sent */
  dropped: DetectorHit[];
}

/* ───────────────────────── literal classification ───────────────────────── */

/** Protocol and format constants. Public vocabulary, no IP, high analysis value. */
const LITERAL_PASSTHROUGH = new Set([
  "", " ", "/", "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS",
  "utf8", "utf-8", "UTF-8", "base64", "hex", "ascii", "binary", "json",
  "application/json", "text/plain", "text/html", "multipart/form-data",
  "application/x-www-form-urlencoded", "use strict", "use client", "use server",
  "development", "production", "test", "staging", "local",
  "GET,POST", "*", "true", "false", "null", "none", "None",
  "sha256", "sha512", "md5", "aes-256-gcm", "HS256", "RS256", "bearer", "Bearer",
  "Authorization", "Content-Type", "Set-Cookie", "Cookie", "X-Request-Id",
  "Strict-Transport-Security", "Content-Security-Policy", "X-Frame-Options",
  "SameSite", "Lax", "Strict", "None", "httpOnly", "secure",
  "asc", "desc", "ASC", "DESC", "id", "uuid", "created_at", "updated_at",
  // Chat roles: protocol vocabulary, and phase 4 needs them to reason about
  // where untrusted input lands in a prompt.
  "system", "user", "assistant", "tool", "function", "developer",
]);

/**
 * Public model identifiers. Which inference vendor and model a system calls is a
 * fact the audit turns on — it decides the transfer analysis and the AI Act
 * classification — and it is not the user's IP.
 */
const MODEL_ID = /^(?:gpt|o[134]|claude|gemini|llama|mistral|mixtral|command|sonar|deepseek|qwen|grok|phi|nova|titan|jamba)[\w.:-]*$/i;
const VENDOR_MODEL_ID = /^(?:openai|anthropic|google|meta-llama|mistralai|perplexity|cohere|deepseek|qwen|x-ai|amazon|microsoft)\/[\w.:-]+$/i;

const SQL_START = /^\s*(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+(?:TABLE|INDEX|POLICY|VIEW|SCHEMA|FUNCTION)|ALTER\s+TABLE|DROP\s+TABLE|GRANT|REVOKE|WITH\s+\w+\s+AS)\b/i;
const PROMPT_HINT = /\b(?:you are|your task|assistant|system prompt|respond with|do not|must not|instructions?:|answer the|the user('s)? )\b/i;

/**
 * §5.1 — string literals become typed placeholders that preserve the shape the
 * analysis needs. A literal matching a secret pattern is dropped entirely.
 */
export function classifyLiteral(value: string): { placeholder: string; dropped: boolean } {
  if (findSecrets(value).length > 0) return { placeholder: "<dropped:secret>", dropped: true };
  if (LITERAL_PASSTHROUGH.has(value)) return { placeholder: value, dropped: false };
  if (MODEL_ID.test(value) || VENDOR_MODEL_ID.test(value)) return { placeholder: value, dropped: false };
  if (value.length === 0) return { placeholder: "", dropped: false };

  if (findPii(value).some((h) => h.rule === "email")) return { placeholder: "<str:email>", dropped: false };
  if (findPii(value).length > 0) return { placeholder: "<str:pii>", dropped: false };

  if (/^https?:\/\//i.test(value)) {
    const internal = /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal)/i.test(value);
    return { placeholder: internal ? "<str:url:internal>" : "<str:url:external>", dropped: false };
  }
  if (/^(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|s3|gs):\/\//i.test(value)) {
    return { placeholder: "<str:connection_string>", dropped: false };
  }
  if (SQL_START.test(value)) return { placeholder: `<str:sql:len:${value.length}>`, dropped: false };
  if (value.length > 60 && PROMPT_HINT.test(value)) return { placeholder: `<str:prompt:len:${value.length}>`, dropped: false };
  if (/^\/[A-Za-z0-9_\-/:.[\]{}]*$/.test(value) && value.length < 80) {
    // route or path — the shape matters for finding endpoints
    return { placeholder: `<str:path:segments:${value.split("/").length - 1}>`, dropped: false };
  }
  if (/^\.{1,2}\//.test(value)) return { placeholder: "<str:relpath>", dropped: false };
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return { placeholder: "<str:uuid>", dropped: false };
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return { placeholder: "<str:date>", dropped: false };
  if (/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value)) {
    return { placeholder: "<str:email>", dropped: false };
  }
  if (/^[a-z0-9-]+\.(?:com|org|net|io|dev|app|ai|co|gh|ng|ke|za|eu|uk)(?:\.[a-z]{2})?$/i.test(value)) {
    return { placeholder: "<str:domain>", dropped: false };
  }
  if (value.length <= 3) return { placeholder: `<str:len:${value.length}>`, dropped: false };
  return { placeholder: `<str:len:${value.length}>`, dropped: false };
}

/** §5.1 — numeric constants above a threshold are bucketed, because limits are IP. */
export function bucketNumber(raw: string, threshold: number): string | null {
  const n = Number(raw.replace(/_/g, ""));
  if (!Number.isFinite(n)) return null;
  const abs = Math.abs(n);
  if (abs < threshold) return null;
  // Common non-IP constants that carry real meaning to the analysis
  if ([1000, 1024, 3000, 3306, 5432, 6379, 8000, 8080, 8443, 27017, 65535].includes(abs)) return null;
  if (abs === 86400 || abs === 3600 || abs === 604800 || abs === 2592000) return null; // durations
  const mag = Math.floor(Math.log10(abs));
  const lo = Math.pow(10, mag);
  const hi = lo * 10;
  return `<num:${lo}..${hi}>`;
}

/* ───────────────────────── identifier kind inference ───────────────────────── */

const SQL_TABLE_CONTEXT = /^(?:from|join|into|update|table|truncate|references)$/i;

function inferKind(tokens: Token[], idx: number, lang: Lang): SymbolKind {
  const prev = prevMeaningful(tokens, idx);
  const next = nextMeaningful(tokens, idx);
  const value = tokens[idx]!.value;

  if (lang === "sql") {
    if (prev && SQL_TABLE_CONTEXT.test(prev.value)) return "tbl";
    if (prev?.value === "." || prev?.value === ",") return "col";
    if (prev && /^(?:select|where|set|and|or|on|by|values)$/i.test(prev.value)) return "col";
    return "col";
  }
  if (prev && /^(?:function|def|fn|func|sub|method)$/.test(prev.value)) return "fn";
  if (prev && /^(?:class|interface|type|struct|enum|trait|impl)$/.test(prev.value)) return "cls";
  if (next?.value === "(") return "fn";
  if (/^[A-Z][A-Za-z0-9]*$/.test(value)) return "cls";
  return "var";
}

function prevMeaningful(tokens: Token[], idx: number): Token | null {
  for (let i = idx - 1; i >= 0 && i > idx - 8; i--) {
    const t = tokens[i]!;
    if (t.kind === "ws" || t.kind === "newline" || t.kind === "comment" || t.kind === "string_delim") continue;
    return t;
  }
  return null;
}

function nextMeaningful(tokens: Token[], idx: number): Token | null {
  for (let i = idx + 1; i < tokens.length && i < idx + 8; i++) {
    const t = tokens[i]!;
    if (t.kind === "ws" || t.kind === "newline" || t.kind === "comment" || t.kind === "string_delim") continue;
    return t;
  }
  return null;
}

/* ───────────────────────── term tokenisation ───────────────────────── */

function buildTermMatchers(terms: readonly string[]): { re: RegExp; term: string }[] {
  return terms
    .filter((t) => t.trim().length >= 3)
    .map((term) => {
      const isWildcard = term.includes("*");
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, (ch) => (ch === "*" ? "[A-Za-z0-9_.-]*" : "\\" + ch));
      return {
        term,
        re: new RegExp(isWildcard ? escaped : `\\b${escaped}\\b`, "gi"),
      };
    });
}

function tokeniseTerms(
  text: string,
  matchers: { re: RegExp; term: string }[],
  map: PseudonymMap,
): { text: string; count: number } {
  let out = text;
  let count = 0;
  for (const { re, term } of matchers) {
    re.lastIndex = 0;
    out = out.replace(re, () => {
      count++;
      return map.symbol(term, "term");
    });
  }
  return { text: out, count };
}

/* ───────────────────────── the redactor ───────────────────────── */

export function redactFile(
  realPath: string,
  source: string,
  opts: RedactOptions,
): RedactedFile {
  const dirOfFile = realPath.includes("/") ? realPath.slice(0, realPath.lastIndexOf("/")) : "";
  const ext = realPath.slice(realPath.lastIndexOf("."));
  const lang = langForExt(ext);
  const threshold = opts.numberThreshold ?? 1000;
  const matchers = buildTermMatchers(opts.terms);
  const stats: RedactStats = {
    identifiers_mapped: 0,
    literals_placeheld: 0,
    literals_dropped: 0,
    comments_stripped: 0,
    numbers_bucketed: 0,
    terms_tokenised: 0,
  };
  const dropped: DetectorHit[] = [];
  const sealedPath = opts.level === 2 ? realPath : opts.map.pathPseudonym(realPath);

  if (opts.level === 2) {
    // Verbatim, but still never a secret: §5.3 outranks the allowlist.
    const secrets = findSecrets(source);
    let content = source;
    for (const hit of secrets) dropped.push(hit);
    if (secrets.length) {
      content = stripSecretLines(source);
      stats.literals_dropped += secrets.length;
    }
    return { real_path: realPath, sealed_path: sealedPath, lang, level: 2, content, stats, dropped };
  }

  const tokens = lex(source, lang);

  if (opts.level === 0) {
    return {
      real_path: realPath,
      sealed_path: sealedPath,
      lang,
      level: 0,
      content: structuralOutline(tokens, lang, sealedPath, opts, stats),
      stats,
      dropped,
    };
  }

  // Level 1 — pseudonymised
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    switch (t.kind) {
      case "comment": {
        if (!opts.keepComments) {
          stats.comments_stripped++;
          // preserve line structure so line numbers stay meaningful
          const nl = (t.value.match(/\n/g) ?? []).length;
          out.push(nl > 0 ? "\n".repeat(nl) : "");
        } else {
          const secrets = findSecrets(t.value);
          if (secrets.length) {
            dropped.push(...secrets);
            stats.literals_dropped++;
            out.push("<comment:dropped:secret>");
          } else {
            const { text, count } = tokeniseTerms(t.value, matchers, opts.map);
            stats.terms_tokenised += count;
            out.push(text);
          }
        }
        break;
      }
      case "string": {
        // Import specifiers: a public package name is a fact the model needs;
        // a relative path is IP and goes through the path map.
        const spec = importSpecifier(tokens, i, lang, t.value, opts, dirOfFile);
        if (spec !== null) {
          out.push(spec);
          break;
        }

        // A literal that names a symbol — `.from("users")`, `.select("email")` —
        // must map to the SAME pseudonym as the schema, or the model cannot join
        // the query to the table it reads.
        const asSymbols = symbolLiteral(t.value, lang, opts, literalKind(tokens, i));
        if (asSymbols !== null) {
          stats.identifiers_mapped++;
          out.push(asSymbols);
          break;
        }

        const { placeholder, dropped: wasDropped } = classifyLiteral(t.value);
        if (wasDropped) {
          dropped.push(...findSecrets(t.value));
          stats.literals_dropped++;
        } else if (placeholder !== t.value) {
          stats.literals_placeheld++;
        }
        const { text, count } = tokeniseTerms(placeholder, matchers, opts.map);
        stats.terms_tokenised += count;
        out.push(text);
        break;
      }
      case "number": {
        const bucketed = bucketNumber(t.value, threshold);
        if (bucketed) {
          stats.numbers_bucketed++;
          out.push(bucketed);
        } else {
          out.push(t.value);
        }
        break;
      }
      case "ident": {
        if (isAllowed(t.value, lang, opts.deps)) {
          out.push(t.value);
        } else {
          const kind = inferKind(tokens, i, lang);
          out.push(opts.map.symbol(t.value, kind));
          stats.identifiers_mapped++;
        }
        break;
      }
      default:
        out.push(t.value);
    }
  }

  let content = out.join("");
  const termPass = tokeniseTerms(content, matchers, opts.map);
  stats.terms_tokenised += termPass.count;
  content = termPass.text;

  return { real_path: realPath, sealed_path: sealedPath, lang, level: 1, content, stats, dropped };
}

/**
 * Import and require specifiers. `"@supabase/supabase-js"` stays; `"./billing/rates"`
 * becomes a pseudonymised path. Returns null when this string is not a specifier.
 */
function importSpecifier(
  tokens: Token[],
  idx: number,
  lang: Lang,
  value: string,
  opts: RedactOptions,
  fromDir: string,
): string | null {
  const prev = prevMeaningful(tokens, idx);
  const prev2 = prev ? prevMeaningful(tokens, tokens.indexOf(prev)) : null;
  const isSpecifierPosition =
    (prev?.value === "from" || prev?.value === "import" || prev?.value === "require") ||
    (prev?.value === "(" && (prev2?.value === "require" || prev2?.value === "import"));
  if (!isSpecifierPosition) return null;
  if (lang !== "ts" && lang !== "js" && lang !== "python") return null;

  if (value.startsWith(".") || value.startsWith("/") || value.startsWith("~/") || value.startsWith("@/")) {
    return opts.map.pathPseudonym(resolveRelative(fromDir, value));
  }
  return value; // public package name
}

/** Collapse `../` so a relative import lands on the file it actually names. */
function resolveRelative(fromDir: string, spec: string): string {
  const cleaned = spec.replace(/^(?:~\/|@\/)/, "").replace(/^\//, "");
  const base = spec.startsWith(".") ? fromDir.split("/").filter(Boolean) : [];
  for (const part of cleaned.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") base.pop();
    else base.push(part);
  }
  return base.join("/");
}

const IDENT_LITERAL = /^[A-Za-z_][A-Za-z0-9_]{1,63}$/;
const IDENT_LIST = /^[A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)+$/;
const DOTTED_IDENT = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/;

/**
 * §5.1 — DB tables and columns are user-defined identifiers wherever they appear,
 * including inside string literals. `users.ghana_card_number` → `tbl_4.col_9`,
 * consistently with the schema file that declared them.
 */
function literalKind(tokens: Token[], idx: number): SymbolKind {
  // `.from("users")`, `.table("users")` name a table; everything else defaults
  // to a column, which is the common case for `.select("email")`.
  const open = prevMeaningful(tokens, idx);
  if (open?.value !== "(") return "col";
  const callee = prevMeaningful(tokens, tokens.indexOf(open));
  if (callee && /^(?:from|table|into|update|insert|collection|model)$/i.test(callee.value)) return "tbl";
  return "col";
}

function symbolLiteral(
  value: string,
  lang: Lang,
  opts: RedactOptions,
  defaultKind: SymbolKind = "col",
): string | null {
  const v = value.trim();
  if (!v || v.length > 200) return null;

  const mapOne = (name: string, kind: SymbolKind): string =>
    isAllowed(name, lang, opts.deps) ? name : opts.map.symbol(name, kind);

  if (IDENT_LITERAL.test(v)) {
    if (isAllowed(v, lang, opts.deps)) return null; // let the placeholder path handle it
    return mapOne(v, defaultKind);
  }
  if (DOTTED_IDENT.test(v)) {
    const parts = v.split(".");
    return parts.map((p, i) => mapOne(p, i === 0 ? "tbl" : "col")).join(".");
  }
  if (IDENT_LIST.test(v)) {
    return v
      .split(",")
      .map((p) => mapOne(p.trim(), "col"))
      .join(", ");
  }
  return null;
}

/** Level-2 safety net: remove any line carrying a detected secret. */
function stripSecretLines(source: string): string {
  const hits = findSecrets(source);
  if (!hits.length) return source;
  const badLines = new Set<number>();
  for (const h of hits) {
    let line = 0;
    for (let i = 0; i < h.index && i < source.length; i++) if (source.charCodeAt(i) === 10) line++;
    badLines.add(line);
  }
  return source
    .split("\n")
    .map((l, i) => (badLines.has(i) ? "<line removed: secret detected>" : l))
    .join("\n");
}

/* ───────────────────────── level 0: structural outline ───────────────────────── */

const DECL_KEYWORDS = /^(?:function|class|interface|type|enum|struct|def|func|fn|const|let|var|export|async|trait|impl|module|namespace)$/;

/**
 * Level 0 — nothing leaves but shape: declarations, signatures, call-graph
 * edges, framework and dependency names. Every identifier pseudonymised, every
 * literal and comment removed.
 */
function structuralOutline(
  tokens: Token[],
  lang: Lang,
  sealedPath: string,
  opts: RedactOptions,
  stats: RedactStats,
): string {
  const lines: string[] = [`module ${sealedPath}  [lang=${lang}]`];
  const imports = new Set<string>();
  const decls: string[] = [];
  const calls = new Set<string>();

  const sym = (name: string, kind: SymbolKind): string => {
    if (isAllowed(name, lang, opts.deps)) return name;
    stats.identifiers_mapped++;
    return opts.map.symbol(name, kind);
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;

    // import specifiers: dependency names pass through, local paths pseudonymise
    if (t.kind === "keyword" && (t.value === "import" || t.value === "require" || t.value === "from")) {
      for (let j = i + 1; j < Math.min(i + 24, tokens.length); j++) {
        const s = tokens[j]!;
        if (s.kind === "string") {
          const spec = s.value;
          if (spec.startsWith(".") || spec.startsWith("/")) {
            imports.add(opts.map.pathPseudonym(spec.replace(/^\.\//, "")));
          } else {
            imports.add(spec); // public package name — a fact, not IP
          }
          break;
        }
        if (s.kind === "newline") break;
      }
    }
    if (lang === "python" && t.kind === "keyword" && t.value === "import") {
      const nxt = nextMeaningful(tokens, i);
      if (nxt?.kind === "ident") imports.add(isAllowed(nxt.value, lang, opts.deps) ? nxt.value : "<local>");
    }

    // declarations with their arity
    if (t.kind === "keyword" && DECL_KEYWORDS.test(t.value)) {
      const name = nextMeaningful(tokens, i);
      if (name && (name.kind === "ident" || name.kind === "keyword")) {
        const kind: SymbolKind =
          /^(?:class|interface|type|enum|struct|trait)$/.test(t.value) ? "cls"
          : /^(?:function|def|func|fn)$/.test(t.value) ? "fn"
          : "var";
        const arity = countParams(tokens, tokens.indexOf(name));
        const sig = arity === null ? "" : `(${arity})`;
        decls.push(`  ${t.value === "export" ? "export " : ""}${kind} ${sym(name.value, kind)}${sig}`);
      }
    }

    // call-graph edges
    if (t.kind === "ident" && nextMeaningful(tokens, i)?.value === "(") {
      const prev = prevMeaningful(tokens, i);
      if (!prev || !/^(?:function|def|func|fn|class)$/.test(prev.value)) {
        calls.add(sym(t.value, "fn"));
      }
    }
  }

  if (imports.size) lines.push(`  imports: ${[...imports].sort().join(", ")}`);
  lines.push(...dedupe(decls));
  if (calls.size) lines.push(`  calls: ${[...calls].sort().slice(0, 80).join(", ")}`);
  return lines.join("\n") + "\n";
}

function countParams(tokens: Token[], nameIdx: number): number | null {
  if (nameIdx < 0) return null;
  let i = nameIdx + 1;
  while (i < tokens.length && (tokens[i]!.kind === "ws" || tokens[i]!.kind === "newline")) i++;
  if (tokens[i]?.value !== "(") return null;
  let depth = 0;
  let params = 0;
  let sawContent = false;
  for (; i < tokens.length; i++) {
    const v = tokens[i]!.value;
    if (v === "(") depth++;
    else if (v === ")") {
      depth--;
      if (depth === 0) break;
    } else if (v === "," && depth === 1) params++;
    else if (depth === 1 && tokens[i]!.kind !== "ws" && tokens[i]!.kind !== "newline") sawContent = true;
  }
  return sawContent ? params + 1 : 0;
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}
