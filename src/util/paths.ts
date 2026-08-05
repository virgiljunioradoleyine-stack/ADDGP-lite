import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join, resolve, relative, sep } from "node:path";
import { homedir } from "node:os";
import { BRAND } from "../brand.ts";

export function repoRoot(cwd = process.cwd()): string {
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, ".git")) || existsSync(join(dir, BRAND.configFile))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(cwd);
    dir = parent;
  }
}

export const paths = (root = repoRoot()) => {
  const state = join(root, BRAND.stateDir);
  const out = join(root, BRAND.outDir);
  return {
    root,
    config: join(root, BRAND.configFile),
    state,
    sovereign: join(state, "sovereign"),
    map: join(state, "sovereign", "map.json"),
    egress: join(state, "egress.jsonl"),
    journal: join(state, "journal.jsonl"),
    answers: join(state, "answers.json"),
    description: join(state, "description.md"),
    cache: join(state, "cache"),
    runs: join(state, "runs"),
    baseline: join(state, "baseline.json"),
    cost: join(state, "cost.jsonl"),
    out,
    outPrompts: join(out, "prompts"),
    outStress: join(out, "stress"),
    assumptions: join(out, "roi.assumptions.yaml"),
    authorization: join(root, "authorization.yaml"),
  };
};

export type Paths = ReturnType<typeof paths>;

/** Where keys live when no OS keychain is available. Outside the repo, always. */
export function keyStorePath(): string {
  return join(homedir(), ".config", BRAND.name, "keys.age");
}

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export function writeFileSecure(file: string, content: string): void {
  ensureDir(dirname(file));
  writeFileSync(file, content, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    /* windows */
  }
}

export function writeOut(file: string, content: string): void {
  ensureDir(dirname(file));
  writeFileSync(file, content, "utf8");
}

export function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(file: string, value: unknown, secure = false): void {
  const text = JSON.stringify(value, null, 2) + "\n";
  if (secure) writeFileSecure(file, text);
  else writeOut(file, text);
}

export function appendJsonl(file: string, value: unknown): void {
  ensureDir(dirname(file));
  const fs = require("node:fs") as typeof import("node:fs");
  fs.appendFileSync(file, JSON.stringify(value) + "\n", { mode: 0o600 });
}

export function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l) as T;
      } catch {
        return null;
      }
    })
    .filter((x): x is T => x !== null);
}

/** Always POSIX-style, so reports and maps are identical across platforms. */
export function relPath(root: string, file: string): string {
  return relative(root, file).split(sep).join("/");
}
