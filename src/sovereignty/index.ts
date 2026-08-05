import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config/index.ts";
import type { Paths } from "../util/paths.ts";
import { readText, walk, type WalkedFile } from "../util/fswalk.ts";
import { matchAny } from "../util/glob.ts";
import { gitRemotes } from "../util/git.ts";
import { denyCheck, type DenyVerdict } from "./denylist.ts";
import { PseudonymMap } from "./pseudonym.ts";
import { redactFile, type Level, type RedactedFile } from "./redactor.ts";
import { rehydrate, rehydrateDeep } from "./rehydrate.ts";
import { sealPayload, renderFileBundle, type SealedMessage, type SealedPayload } from "./seal.ts";
import { findSecrets, type DetectorHit } from "./secrets.ts";

export * from "./seal.ts";
export * from "./gate.ts";
export { rehydrate, rehydrateDeep } from "./rehydrate.ts";
export type { Level, RedactedFile } from "./redactor.ts";

export interface PreviewEntry {
  path: string;
  status: "sent" | "denied" | "unreadable" | "excluded";
  reason?: string;
  sealed_path?: string;
  original_bytes: number;
  sealed_bytes: number;
  identifiers_mapped?: number;
  literals_placeheld?: number;
  literals_dropped?: number;
  comments_stripped?: number;
  preview?: string;
}

/**
 * Phase 0. Builds the redaction map and gates all egress. Every other phase that
 * wants to talk to a vendor must go through `seal*` here — there is no other way
 * to construct a SealedPayload.
 */
export class Sovereignty {
  readonly map: PseudonymMap;
  readonly level: Level;
  readonly terms: string[];
  readonly deps: Set<string>;

  private constructor(
    readonly cfg: Config,
    readonly paths: Paths,
    level: Level,
    map: PseudonymMap,
    terms: string[],
    deps: Set<string>,
  ) {
    this.level = level;
    this.map = map;
    this.terms = terms;
    this.deps = deps;
  }

  static create(cfg: Config, paths: Paths, levelOverride?: Level, ephemeral = false): Sovereignty {
    const level = (levelOverride ?? cfg.sovereignty.level) as Level;
    const map = ephemeral ? PseudonymMap.ephemeral() : PseudonymMap.load(paths.map);
    const deps = collectDependencyNames(paths.root);
    const terms = [...new Set([...cfg.sovereignty.tokenise_terms, ...autoDetectTerms(paths.root, cfg)])];
    return new Sovereignty(cfg, paths, level, map, terms, deps);
  }

  get neverSend(): string[] {
    return this.cfg.sovereignty.never_send;
  }

  /** Is this path allowed to be read verbatim (level 2)? Allowlist only, never global. */
  private levelFor(path: string): Level {
    if (this.level !== 2) return this.level;
    const allow = this.cfg.sovereignty.verbatim_allowlist;
    if (!allow.length) return 1;
    return matchAny(path, allow) ? 2 : 1;
  }

  check(path: string): DenyVerdict {
    return denyCheck(path, this.neverSend);
  }

  /** Redact one already-read file. Returns null when the path is denied. */
  redact(path: string, source: string): RedactedFile | null {
    if (this.check(path).denied) return null;
    return redactFile(path, source, {
      level: this.levelFor(path),
      keepComments: this.cfg.sovereignty.keep_comments,
      terms: this.terms,
      deps: this.deps,
      map: this.map,
    });
  }

  redactMany(files: { path: string; source: string }[]): RedactedFile[] {
    const out: RedactedFile[] = [];
    for (const f of files) {
      const r = this.redact(f.path, f.source);
      if (r) out.push(r);
    }
    return out;
  }

  /**
   * §5.4 — render exactly what would be sent, per file, before any call is made.
   * Writes nothing and contacts nothing.
   */
  preview(limitPerFile = 900): PreviewEntry[] {
    const files = walk(this.paths.root, {
      include: this.cfg.scan.include,
      exclude: this.cfg.scan.exclude,
      maxFileKb: this.cfg.scan.max_file_kb,
    });
    const entries: PreviewEntry[] = [];
    for (const f of files) {
      const verdict = this.check(f.path);
      if (verdict.denied) {
        entries.push({
          path: f.path,
          status: "denied",
          reason: `${verdict.reason}: ${verdict.explanation}`,
          original_bytes: f.size,
          sealed_bytes: 0,
        });
        continue;
      }
      const source = readText(f.abs, f.ext);
      if (source === null) {
        entries.push({
          path: f.path,
          status: "unreadable",
          reason: "binary or non-text content is never sent",
          original_bytes: f.size,
          sealed_bytes: 0,
        });
        continue;
      }
      const r = this.redact(f.path, source);
      if (!r) continue;
      entries.push({
        path: f.path,
        status: "sent",
        sealed_path: r.sealed_path,
        original_bytes: Buffer.byteLength(source, "utf8"),
        sealed_bytes: Buffer.byteLength(r.content, "utf8"),
        identifiers_mapped: r.stats.identifiers_mapped,
        literals_placeheld: r.stats.literals_placeheld,
        literals_dropped: r.stats.literals_dropped,
        comments_stripped: r.stats.comments_stripped,
        preview: r.content.slice(0, limitPerFile),
      });
    }
    return entries;
  }

  /** Seal a code bundle. The only path from repository content to a vendor. */
  sealCode(
    system: string,
    user: string,
    files: readonly RedactedFile[],
    purpose: string,
  ): SealedPayload {
    const body = files.length ? `${user}\n\n${renderFileBundle(files)}` : user;
    return sealPayload({
      messages: [
        { role: "system", content: system },
        { role: "user", content: body },
      ],
      represents: files.map((f) => f.real_path),
      level: this.level,
      purpose,
      code_free: files.length === 0,
    });
  }

  /** Seal a payload that carries no repository content at all (e.g. legal queries). */
  sealText(messages: SealedMessage[], purpose: string): SealedPayload {
    for (const m of messages) {
      const secrets = findSecrets(m.content);
      if (secrets.length) {
        throw new Error(
          `Refusing to seal a text payload containing ${secrets[0]!.label}. This is a bug in the caller.`,
        );
      }
    }
    return sealPayload({ messages, represents: [], level: this.level, purpose, code_free: true });
  }

  rehydrate<T>(value: T): T {
    return rehydrateDeep(value, this.map);
  }

  rehydrateText(text: string): string {
    return rehydrate(text, this.map);
  }

  save(): void {
    this.map.save();
  }
}

/* ───────────────────────── manifests and terms ───────────────────────── */

export function collectDependencyNames(root: string): Set<string> {
  const deps = new Set<string>();
  const add = (name: string) => {
    const n = name.trim();
    if (!n) return;
    deps.add(n);
    // @scope/pkg → also register the bare segment, and the camel form
    const bare = n.includes("/") ? n.split("/").pop()! : n;
    deps.add(bare);
    deps.add(bare.replace(/[-_.]/g, ""));
    deps.add(bare.replace(/[-_.](\w)/g, (_, c: string) => c.toUpperCase()));
  };

  const pkg = readJsonSafe(join(root, "package.json"));
  if (pkg) {
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      const obj = (pkg as Record<string, unknown>)[field];
      if (obj && typeof obj === "object") Object.keys(obj as object).forEach(add);
    }
  }

  const req = readIfExists(join(root, "requirements.txt"));
  if (req) for (const line of req.split("\n")) add(line.split(/[<>=!~[;# ]/)[0] ?? "");

  const pyproject = readIfExists(join(root, "pyproject.toml"));
  if (pyproject) {
    for (const m of pyproject.matchAll(/^\s*["']?([A-Za-z0-9._-]+)["']?\s*=\s*["'][^"']*["']/gm)) add(m[1]!);
    for (const m of pyproject.matchAll(/^\s*["']([A-Za-z0-9._-]+)\s*[<>=~!]/gm)) add(m[1]!);
  }

  const gomod = readIfExists(join(root, "go.mod"));
  if (gomod) for (const m of gomod.matchAll(/^\s*(?:require\s+)?([\w.\-/]+\.\w+\/[\w.\-/]+)\s+v/gm)) {
    add(m[1]!);
    add(m[1]!.split("/").pop()!);
  }

  const gemfile = readIfExists(join(root, "Gemfile"));
  if (gemfile) for (const m of gemfile.matchAll(/gem\s+['"]([^'"]+)['"]/g)) add(m[1]!);

  const composer = readJsonSafe(join(root, "composer.json"));
  if (composer) {
    for (const field of ["require", "require-dev"]) {
      const obj = (composer as Record<string, unknown>)[field];
      if (obj && typeof obj === "object") Object.keys(obj as object).forEach(add);
    }
  }

  const cargo = readIfExists(join(root, "Cargo.toml"));
  if (cargo) for (const m of cargo.matchAll(/^\s*([A-Za-z0-9_-]+)\s*=\s*[{"]/gm)) add(m[1]!);

  return deps;
}

/**
 * Company, product, and domain names, auto-detected from package.json, git
 * remotes, and the README (§5.1). Combined with the user's own list.
 */
export function autoDetectTerms(root: string, cfg: Config): string[] {
  const terms = new Set<string>();
  const addName = (v: unknown) => {
    if (typeof v !== "string") return;
    const s = v.trim();
    if (s.length >= 3 && s.length <= 64) terms.add(s);
  };

  if (cfg.project.name) addName(cfg.project.name);

  const pkg = readJsonSafe(join(root, "package.json")) as Record<string, unknown> | null;
  if (pkg) {
    addName(pkg.name);
    if (typeof pkg.name === "string" && pkg.name.startsWith("@")) {
      addName(pkg.name.slice(1).split("/")[0]);
    }
    const author = pkg.author;
    if (typeof author === "string") addName(author.replace(/<[^>]*>/g, "").trim());
    else if (author && typeof author === "object") addName((author as Record<string, unknown>).name);
    for (const key of ["homepage", "repository"]) {
      const v = pkg[key];
      const url = typeof v === "string" ? v : (v as Record<string, unknown> | undefined)?.url;
      if (typeof url === "string") {
        const host = url.match(/(?:https?:\/\/|@)([\w.-]+\.\w+)/)?.[1];
        if (host && !/github\.com|gitlab\.com|bitbucket\.org|npmjs\.com/.test(host)) terms.add(host);
      }
    }
  }

  for (const remote of gitRemotes(root)) {
    const m = remote.match(/[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
    if (m) {
      addName(m[1]);
      addName(m[2]);
    }
  }

  const readme = ["README.md", "README.MD", "readme.md", "README.rst", "README.txt"]
    .map((f) => join(root, f))
    .find((f) => existsSync(f));
  if (readme) {
    const text = readIfExists(readme) ?? "";
    const heading = text.match(/^#\s+(.+)$/m)?.[1];
    if (heading) {
      const cleaned = heading.replace(/[^\w\s.-]/g, "").trim();
      if (cleaned.length >= 3 && cleaned.length <= 48) addName(cleaned);
    }
    for (const m of text.matchAll(/https?:\/\/([\w-]+\.[\w.-]+)/g)) {
      const host = m[1]!;
      if (!/github|gitlab|shields\.io|npmjs|badge|licen[cs]e|opensource|mit-license|vercel\.app|readthedocs/.test(host)) {
        terms.add(host);
      }
    }
  }

  // Never tokenise generic words — that would mangle the code for no gain.
  const STOP = new Set(["app", "api", "web", "src", "lib", "core", "main", "test", "server", "client", "www"]);
  return [...terms].filter((t) => t.length >= 3 && !STOP.has(t.toLowerCase()));
}

function readJsonSafe(file: string): unknown | null {
  const text = readIfExists(file);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readIfExists(file: string): string | null {
  if (!existsSync(file)) return null;
  return readText(file, file.slice(file.lastIndexOf(".")));
}

export function walkRepo(root: string, cfg: Config): WalkedFile[] {
  return walk(root, {
    include: cfg.scan.include,
    exclude: cfg.scan.exclude,
    maxFileKb: cfg.scan.max_file_kb,
  });
}

export type { DetectorHit };
