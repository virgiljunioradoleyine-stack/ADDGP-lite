import { existsSync } from "node:fs";
import { join } from "node:path";
import { exec, hasCommand } from "./exec.ts";

export function isGitRepo(root: string): boolean {
  return existsSync(join(root, ".git"));
}

export function gitAvailable(): boolean {
  return hasCommand("git");
}

export function gitRemotes(root: string): string[] {
  if (!isGitRepo(root) || !gitAvailable()) return [];
  const r = exec("git", ["remote", "-v"], root);
  if (!r.ok) return [];
  const urls = new Set<string>();
  for (const line of r.stdout.split("\n")) {
    const m = line.match(/\s(\S+)\s\((?:fetch|push)\)/);
    if (m?.[1]) urls.add(m[1]);
  }
  return [...urls];
}

export function gitHead(root: string): string | null {
  if (!isGitRepo(root) || !gitAvailable()) return null;
  const r = exec("git", ["rev-parse", "HEAD"], root);
  return r.ok ? r.stdout.trim() : null;
}

export function gitIsDirty(root: string): boolean {
  const r = exec("git", ["status", "--porcelain"], root);
  return r.ok && r.stdout.trim().length > 0;
}

/** Files changed since a ref — powers `scan --since`. */
export function gitChangedSince(root: string, ref: string): string[] | null {
  const r = exec("git", ["diff", "--name-only", `${ref}...HEAD`], root);
  if (!r.ok) {
    const r2 = exec("git", ["diff", "--name-only", ref], root);
    if (!r2.ok) return null;
    return r2.stdout.split("\n").filter(Boolean);
  }
  return r.stdout.split("\n").filter(Boolean);
}

/**
 * Blobs reachable from history. Used by the secret scanner, which must look at
 * deleted commits too — a key removed in the next commit is still a leaked key.
 * Returns [] when git is unavailable rather than pretending history is clean.
 */
export function gitHistoryBlobs(root: string, limit = 4000): { sha: string; path: string }[] {
  if (!isGitRepo(root) || !gitAvailable()) return [];
  const r = exec("git", ["rev-list", "--objects", "--all"], root, 60_000);
  if (!r.ok) return [];
  const out: { sha: string; path: string }[] = [];
  for (const line of r.stdout.split("\n")) {
    const sp = line.indexOf(" ");
    if (sp <= 0) continue;
    const sha = line.slice(0, sp);
    const path = line.slice(sp + 1).trim();
    if (!path) continue;
    out.push({ sha, path });
    if (out.length >= limit) break;
  }
  return out;
}

export function gitShowBlob(root: string, sha: string): string | null {
  const r = exec("git", ["cat-file", "-p", sha], root, 10_000);
  if (!r.ok) return null;
  if (r.stdout.includes("\0")) return null;
  return r.stdout;
}
