/**
 * A small, auditable, config-driven lexer.
 *
 * It exists so the redactor can rewrite identifiers and literals without ever
 * confusing a word inside a comment for a variable name. It is deliberately not
 * a full parser: it must never crash, never hang, and must always satisfy
 *   tokens.map(t => t.value).join("") === source
 * which is what makes Level-1 output a faithful structural copy.
 */

export type TokKind =
  | "ident"
  | "keyword"
  | "string"
  | "string_delim"
  | "comment"
  | "number"
  | "punct"
  | "ws"
  | "newline";

export interface Token {
  kind: TokKind;
  value: string;
  line: number;
  /** for string tokens: the quote style, so the redactor can re-emit it */
  quote?: string;
}

export type Lang =
  | "ts" | "js" | "python" | "sql" | "yaml" | "json" | "go" | "java" | "rust"
  | "ruby" | "php" | "csharp" | "shell" | "hcl" | "generic";

interface LangSpec {
  lineComment: string[];
  blockComment: [string, string][];
  strings: { open: string; close: string; multiline?: boolean; interpolate?: boolean }[];
  keywords: Set<string>;
  identStart: RegExp;
  identPart: RegExp;
}

const kw = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

const JS_KEYWORDS = kw(`
  abstract any as async await boolean break case catch class const constructor continue
  debugger declare default delete do else enum export extends false finally for from
  function get if implements import in infer instanceof interface is keyof let module
  namespace never new null number object of package private protected public readonly
  record require return satisfies set static string super switch symbol this throw true
  try type typeof undefined union unique unknown var void while with yield
`);

const PY_KEYWORDS = kw(`
  and as assert async await break class continue def del elif else except False finally
  for from global if import in is lambda None nonlocal not or pass raise return True try
  while with yield self cls match case
`);

const SQL_KEYWORDS = kw(`
  select insert update delete from where join inner left right outer full on group by
  having order limit offset union all distinct as into values set create table alter drop
  index view schema database primary key foreign references constraint unique not null
  default check cascade grant revoke to public policy row level security enable using
  with returning and or in exists between like ilike is case when then else end begin
  commit rollback transaction function trigger returns language declare
`);

const GO_KEYWORDS = kw(`
  break case chan const continue default defer else fallthrough for func go goto if import
  interface map package range return select struct switch type var nil true false error
  string int int64 float64 bool byte rune make new len cap append
`);

const GENERIC_KEYWORDS = kw(`
  if else for while return function class import export const let var public private
  protected static void int string bool true false null new try catch finally throw
`);

const SPECS: Record<Lang, LangSpec> = {
  ts: {
    lineComment: ["//"],
    blockComment: [["/*", "*/"]],
    strings: [
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: "`", close: "`", multiline: true, interpolate: true },
    ],
    keywords: JS_KEYWORDS,
    identStart: /[A-Za-z_$]/,
    identPart: /[A-Za-z0-9_$]/,
  },
  js: {
    lineComment: ["//"],
    blockComment: [["/*", "*/"]],
    strings: [
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: "`", close: "`", multiline: true, interpolate: true },
    ],
    keywords: JS_KEYWORDS,
    identStart: /[A-Za-z_$]/,
    identPart: /[A-Za-z0-9_$]/,
  },
  python: {
    lineComment: ["#"],
    blockComment: [],
    strings: [
      { open: '"""', close: '"""', multiline: true },
      { open: "'''", close: "'''", multiline: true },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    keywords: PY_KEYWORDS,
    identStart: /[A-Za-z_]/,
    identPart: /[A-Za-z0-9_]/,
  },
  sql: {
    lineComment: ["--"],
    blockComment: [["/*", "*/"]],
    strings: [
      { open: "'", close: "'" },
      { open: '"', close: '"' },
    ],
    keywords: SQL_KEYWORDS,
    identStart: /[A-Za-z_]/,
    identPart: /[A-Za-z0-9_]/,
  },
  yaml: {
    lineComment: ["#"],
    blockComment: [],
    strings: [
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    keywords: new Set(),
    identStart: /[A-Za-z_]/,
    identPart: /[A-Za-z0-9_.-]/,
  },
  json: {
    lineComment: [],
    blockComment: [],
    strings: [{ open: '"', close: '"' }],
    keywords: kw("true false null"),
    identStart: /[A-Za-z_]/,
    identPart: /[A-Za-z0-9_]/,
  },
  go: {
    lineComment: ["//"],
    blockComment: [["/*", "*/"]],
    strings: [
      { open: '"', close: '"' },
      { open: "`", close: "`", multiline: true },
    ],
    keywords: GO_KEYWORDS,
    identStart: /[A-Za-z_]/,
    identPart: /[A-Za-z0-9_]/,
  },
  java: {
    lineComment: ["//"],
    blockComment: [["/*", "*/"]],
    strings: [{ open: '"', close: '"' }, { open: "'", close: "'" }],
    keywords: GENERIC_KEYWORDS,
    identStart: /[A-Za-z_$]/,
    identPart: /[A-Za-z0-9_$]/,
  },
  rust: {
    lineComment: ["//"],
    blockComment: [["/*", "*/"]],
    strings: [{ open: '"', close: '"' }],
    keywords: kw(`
      as async await break const continue crate dyn else enum extern false fn for if impl
      in let loop match mod move mut pub ref return self Self static struct super trait
      true type unsafe use where while
    `),
    identStart: /[A-Za-z_]/,
    identPart: /[A-Za-z0-9_]/,
  },
  ruby: {
    lineComment: ["#"],
    blockComment: [],
    strings: [{ open: '"', close: '"' }, { open: "'", close: "'" }],
    keywords: kw(`
      def end class module if elsif else unless while until do then begin rescue ensure
      return yield self nil true false and or not require require_relative attr_accessor
    `),
    identStart: /[A-Za-z_@$]/,
    identPart: /[A-Za-z0-9_?!]/,
  },
  php: {
    lineComment: ["//", "#"],
    blockComment: [["/*", "*/"]],
    strings: [{ open: '"', close: '"' }, { open: "'", close: "'" }],
    keywords: GENERIC_KEYWORDS,
    identStart: /[A-Za-z_$]/,
    identPart: /[A-Za-z0-9_]/,
  },
  csharp: {
    lineComment: ["//"],
    blockComment: [["/*", "*/"]],
    strings: [{ open: '"', close: '"' }],
    keywords: GENERIC_KEYWORDS,
    identStart: /[A-Za-z_]/,
    identPart: /[A-Za-z0-9_]/,
  },
  shell: {
    lineComment: ["#"],
    blockComment: [],
    strings: [{ open: '"', close: '"' }, { open: "'", close: "'" }],
    keywords: kw("if then else fi for while do done case esac function export local return"),
    identStart: /[A-Za-z_]/,
    identPart: /[A-Za-z0-9_]/,
  },
  hcl: {
    lineComment: ["#", "//"],
    blockComment: [["/*", "*/"]],
    strings: [{ open: '"', close: '"' }],
    keywords: kw("resource variable module output provider data locals terraform true false null"),
    identStart: /[A-Za-z_]/,
    identPart: /[A-Za-z0-9_-]/,
  },
  generic: {
    lineComment: ["#", "//"],
    blockComment: [["/*", "*/"]],
    strings: [{ open: '"', close: '"' }, { open: "'", close: "'" }],
    keywords: GENERIC_KEYWORDS,
    identStart: /[A-Za-z_]/,
    identPart: /[A-Za-z0-9_]/,
  },
};

const EXT_LANG: Record<string, Lang> = {
  ".ts": "ts", ".tsx": "ts", ".mts": "ts", ".cts": "ts",
  ".js": "js", ".jsx": "js", ".mjs": "js", ".cjs": "js",
  ".py": "python", ".pyi": "python",
  ".sql": "sql",
  ".yaml": "yaml", ".yml": "yaml",
  ".json": "json", ".jsonc": "json",
  ".go": "go",
  ".java": "java", ".kt": "java", ".kts": "java", ".scala": "java", ".swift": "java",
  ".rs": "rust",
  ".rb": "ruby",
  ".php": "php",
  ".cs": "csharp",
  ".sh": "shell", ".bash": "shell", ".zsh": "shell",
  ".tf": "hcl", ".tfvars": "hcl", ".hcl": "hcl",
  ".c": "java", ".h": "java", ".cpp": "java", ".hpp": "java", ".m": "java",
};

export function langForExt(ext: string): Lang {
  return EXT_LANG[ext.toLowerCase()] ?? "generic";
}

export function langKeywords(lang: Lang): Set<string> {
  return SPECS[lang].keywords;
}

/** Hard cap so a pathological file can never wedge a run. */
const MAX_TOKENS = 400_000;

export function lex(source: string, lang: Lang): Token[] {
  const spec = SPECS[lang] ?? SPECS.generic;
  const out: Token[] = [];
  let i = 0;
  let line = 1;
  const n = source.length;

  const push = (kind: TokKind, value: string, quote?: string) => {
    if (!value) return;
    out.push(quote === undefined ? { kind, value, line } : { kind, value, line, quote });
    for (let k = 0; k < value.length; k++) if (value.charCodeAt(k) === 10) line++;
  };

  while (i < n && out.length < MAX_TOKENS) {
    const ch = source[i]!;

    // newline
    if (ch === "\n") {
      push("newline", "\n");
      i++;
      continue;
    }

    // whitespace
    if (ch === " " || ch === "\t" || ch === "\r") {
      let j = i;
      while (j < n && (source[j] === " " || source[j] === "\t" || source[j] === "\r")) j++;
      push("ws", source.slice(i, j));
      i = j;
      continue;
    }

    // line comment
    let matchedComment = false;
    for (const lc of spec.lineComment) {
      if (source.startsWith(lc, i)) {
        let j = source.indexOf("\n", i);
        if (j === -1) j = n;
        push("comment", source.slice(i, j));
        i = j;
        matchedComment = true;
        break;
      }
    }
    if (matchedComment) continue;

    // block comment
    for (const [open, close] of spec.blockComment) {
      if (source.startsWith(open, i)) {
        let j = source.indexOf(close, i + open.length);
        j = j === -1 ? n : j + close.length;
        push("comment", source.slice(i, j));
        i = j;
        matchedComment = true;
        break;
      }
    }
    if (matchedComment) continue;

    // strings — longest delimiter first, so """ beats "
    const delims = [...spec.strings].sort((a, b) => b.open.length - a.open.length);
    let matchedString = false;
    for (const d of delims) {
      if (!source.startsWith(d.open, i)) continue;
      const start = i + d.open.length;
      let j = start;
      let body = "";
      for (;;) {
        if (j >= n) break;
        const cj = source[j]!;
        if (cj === "\\") {
          body += source.slice(j, j + 2);
          j += 2;
          continue;
        }
        if (!d.multiline && cj === "\n") break; // unterminated; do not swallow the file
        if (source.startsWith(d.close, j)) break;
        body += cj;
        j++;
      }
      const closed = source.startsWith(d.close, j);
      push("string_delim", d.open);
      push("string", body, d.open);
      if (closed) {
        push("string_delim", d.close);
        i = j + d.close.length;
      } else {
        i = j;
      }
      matchedString = true;
      break;
    }
    if (matchedString) continue;

    // number
    if (ch >= "0" && ch <= "9") {
      let j = i;
      while (j < n && /[0-9a-fA-FxXoObB_.eE+-]/.test(source[j]!)) {
        // stop a trailing +/- that is not part of an exponent
        if ((source[j] === "+" || source[j] === "-") && !/[eE]/.test(source[j - 1] ?? "")) break;
        j++;
      }
      push("number", source.slice(i, j));
      i = j;
      continue;
    }

    // identifier / keyword
    if (spec.identStart.test(ch)) {
      let j = i + 1;
      while (j < n && spec.identPart.test(source[j]!)) j++;
      const word = source.slice(i, j);
      push(spec.keywords.has(word) ? "keyword" : "ident", word);
      i = j;
      continue;
    }

    // punctuation — take a run of non-identifier, non-space characters one at a time
    push("punct", ch);
    i++;
  }

  // Anything past the token cap is preserved verbatim as one blob so that
  // join() still reconstructs the source exactly.
  if (i < n) push("string", source.slice(i));

  return out;
}

/** Invariant used by the sovereignty tests. */
export function detokenize(tokens: Token[]): string {
  return tokens.map((t) => t.value).join("");
}
