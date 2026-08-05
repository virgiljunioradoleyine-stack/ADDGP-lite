import { existsSync, readFileSync } from "node:fs";
import { sha256 } from "../util/hash.ts";
import { writeFileSecure } from "../util/paths.ts";

export type SymbolKind =
  | "module" | "dir" | "file" | "fn" | "cls" | "var" | "tbl" | "col" | "term" | "route";

const PREFIX: Record<SymbolKind, string> = {
  module: "mod",
  dir: "dir",
  file: "svc",
  fn: "fn",
  cls: "cls",
  var: "v",
  tbl: "tbl",
  col: "col",
  term: "term",
  route: "rt",
};

interface MapFile {
  version: 1;
  /** salt makes pseudonyms unguessable across projects while staying stable within one */
  salt: string;
  created_at: string;
  /** real → pseudonym, keyed "kind:real" */
  forward: Record<string, string>;
  /** pseudonym → real. The half that must never leave the machine. */
  reverse: Record<string, string>;
}

/**
 * The pseudonym table (§5.2). Lives at .addgp/sovereign/map.json, mode 0600,
 * gitignored, and is never included in any payload, cache entry, or export.
 *
 * Pseudonyms are hash-derived rather than sequential so that two runs over the
 * same repo produce byte-identical sealed payloads regardless of file order —
 * which is what makes cached runs and golden tests reproducible.
 */
export class PseudonymMap {
  private data: MapFile;
  private dirty = false;

  private constructor(
    private readonly file: string,
    data: MapFile,
  ) {
    this.data = data;
  }

  static load(file: string, salt?: string): PseudonymMap {
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, "utf8")) as MapFile;
        if (parsed.version === 1 && parsed.forward && parsed.reverse) {
          return new PseudonymMap(file, parsed);
        }
      } catch {
        /* corrupt map — rebuild rather than fail the run */
      }
    }
    return new PseudonymMap(file, {
      version: 1,
      salt: salt ?? sha256(String(Date.now()) + Math.random()).slice(0, 16),
      created_at: new Date().toISOString(),
      forward: {},
      reverse: {},
    });
  }

  /** In-memory only. Used by `sovereignty preview` so a preview writes nothing. */
  static ephemeral(salt = "preview"): PseudonymMap {
    return new PseudonymMap("", {
      version: 1,
      salt,
      created_at: new Date().toISOString(),
      forward: {},
      reverse: {},
    });
  }

  get salt(): string {
    return this.data.salt;
  }

  get size(): number {
    return Object.keys(this.data.reverse).length;
  }

  private mint(kind: SymbolKind, real: string): string {
    const base = PREFIX[kind];
    for (let attempt = 0; attempt < 64; attempt++) {
      const h = sha256(`${this.data.salt}:${kind}:${real}:${attempt}`);
      // base36 keeps them short and readable: fn_a7c3
      const suffix = BigInt("0x" + h.slice(0, 10)).toString(36).slice(0, 4);
      const candidate = `${base}_${suffix}`;
      if (!this.data.reverse[candidate]) return candidate;
    }
    return `${base}_${sha256(real).slice(0, 10)}`;
  }

  pseudonym(kind: SymbolKind, real: string): string {
    const key = `${kind}:${real}`;
    const existing = this.data.forward[key];
    if (existing) return existing;
    const p = this.mint(kind, real);
    this.data.forward[key] = p;
    this.data.reverse[p] = real;
    this.dirty = true;
    return p;
  }

  /**
   * One pseudonym per source-code symbol name, whatever kind it was first seen
   * as. `users` must not become `tbl_x` in the schema and `v_y` in the handler,
   * or the model loses the join that makes a finding possible.
   */
  symbol(name: string, kindHint: SymbolKind = "var"): string {
    const key = `sym:${name}`;
    const existing = this.data.forward[key];
    if (existing) return existing;
    const p = this.mint(kindHint, name);
    this.data.forward[key] = p;
    this.data.reverse[p] = name;
    this.dirty = true;
    return p;
  }

  /** Pseudonymise a repo-relative path, segment by segment, keeping the extension. */
  pathPseudonym(path: string): string {
    const existing = this.data.forward[`path:${path}`];
    if (existing) return existing;
    const parts = path.split("/");
    const fileName = parts.pop() ?? path;
    const dot = fileName.lastIndexOf(".");
    const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
    const ext = dot > 0 ? fileName.slice(dot) : "";
    const dirs = parts.map((d) => this.pseudonym("module", d));
    const file = this.pseudonym("file", stem) + ext;
    const out = [...dirs, file].join("/");
    this.data.forward[`path:${path}`] = out;
    this.data.reverse[out] = path;
    this.dirty = true;
    return out;
  }

  real(pseudonym: string): string | null {
    return this.data.reverse[pseudonym] ?? null;
  }

  /** All pseudonyms, longest first — the order the rehydrator must replace in. */
  pseudonyms(): string[] {
    return Object.keys(this.data.reverse).sort((a, b) => b.length - a.length);
  }

  entries(): { pseudonym: string; real: string }[] {
    return Object.entries(this.data.reverse).map(([pseudonym, real]) => ({ pseudonym, real }));
  }

  save(): void {
    if (!this.file || !this.dirty) return;
    writeFileSecure(this.file, JSON.stringify(this.data, null, 2));
    this.dirty = false;
  }
}
