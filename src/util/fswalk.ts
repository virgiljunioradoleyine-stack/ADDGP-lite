import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { relPath } from "./paths.ts";
import { matchAny } from "./glob.ts";

export interface WalkOptions {
  include?: readonly string[];
  exclude?: readonly string[];
  maxFileKb?: number;
  followSymlinks?: boolean;
}

const ALWAYS_SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".addgp",
  "dist",
  "build",
  ".next",
  ".turbo",
  "vendor",
  "target",
  "__pycache__",
  ".venv",
  "venv",
  ".mypy_cache",
  ".pytest_cache",
  "coverage",
  ".gradle",
  ".idea",
  ".vscode",
]);

export interface WalkedFile {
  /** repo-relative, POSIX separators */
  path: string;
  abs: string;
  size: number;
  ext: string;
}

export function walk(root: string, opts: WalkOptions = {}): WalkedFile[] {
  const maxBytes = (opts.maxFileKb ?? 512) * 1024;
  const out: WalkedFile[] = [];

  const rec = (dir: string, depth: number) => {
    if (depth > 24) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (ALWAYS_SKIP_DIRS.has(name)) continue;
      const abs = join(dir, name);
      let st;
      try {
        st = opts.followSymlinks ? statSync(abs) : statSync(abs, { throwIfNoEntry: false });
      } catch {
        continue;
      }
      if (!st) continue;
      if (st.isDirectory()) {
        rec(abs, depth + 1);
        continue;
      }
      if (!st.isFile()) continue;
      const rel = relPath(root, abs);
      if (opts.exclude?.length && matchAny(rel, opts.exclude)) continue;
      if (opts.include?.length && !matchAny(rel, opts.include)) continue;
      if (st.size > maxBytes) continue;
      const dot = name.lastIndexOf(".");
      out.push({
        path: rel,
        abs,
        size: st.size,
        ext: dot > 0 ? name.slice(dot).toLowerCase() : "",
      });
    }
  };

  rec(root, 0);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".tiff", ".pdf",
  ".zip", ".gz", ".tar", ".bz2", ".xz", ".7z", ".rar", ".jar", ".war",
  ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp3", ".mp4", ".mov", ".avi",
  ".wasm", ".so", ".dylib", ".dll", ".exe", ".bin", ".class", ".pyc", ".node",
  ".sqlite", ".db", ".parquet", ".avro", ".orc",
]);

export function isBinaryExt(ext: string): boolean {
  return BINARY_EXT.has(ext);
}

/** Read as text, or null if it is not plausibly text. */
export function readText(abs: string, ext = ""): string | null {
  if (isBinaryExt(ext)) return null;
  try {
    const buf = readFileSync(abs);
    // NUL byte in the first 8k => binary
    const probe = buf.subarray(0, 8192);
    if (probe.includes(0)) return null;
    return buf.toString("utf8");
  } catch {
    return null;
  }
}

export function readIfExists(abs: string): string | null {
  return existsSync(abs) ? readText(abs) : null;
}
