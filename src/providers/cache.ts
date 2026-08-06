import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "../util/hash.ts";
import { ensureDir, writeJson, type Paths } from "../util/paths.ts";
import { daysBetween } from "../util/time.ts";

export interface CacheEntry<T = unknown> {
  key: string;
  created_at: string;
  prompt_version: string;
  model_id: string;
  /** never the payload itself — only its hash, so the cache cannot leak code */
  input_hash: string;
  value: T;
}

/**
 * §13 — cache key = hash(prompt_version + sealed_input_hash + model_id + params).
 * The cache stores model OUTPUT keyed by an input HASH: a cache directory copied
 * to another machine reveals nothing about the source it was derived from, which
 * is what makes `cache export` safe to put on a USB stick.
 */
export function cacheKey(parts: {
  promptVersion: string;
  inputHash: string;
  modelId: string;
  params: Record<string, unknown>;
}): string {
  return sha256(
    [
      parts.promptVersion,
      parts.inputHash,
      parts.modelId,
      JSON.stringify(Object.entries(parts.params).sort()),
    ].join("|"),
  );
}

export class Cache {
  constructor(private readonly paths: Paths) {}

  private file(key: string): string {
    return join(this.paths.cache, key.slice(0, 2), `${key}.json`);
  }

  get<T>(key: string, ttlDays: number): T | null {
    const f = this.file(key);
    if (!existsSync(f)) return null;
    try {
      const entry = JSON.parse(readFileSync(f, "utf8")) as CacheEntry<T>;
      if (daysBetween(entry.created_at) > ttlDays) return null;
      return entry.value;
    } catch {
      return null;
    }
  }

  /** Age of an entry in days, or null when absent. Used to banner a stale corpus. */
  ageDays(key: string): number | null {
    const f = this.file(key);
    if (!existsSync(f)) return null;
    try {
      const entry = JSON.parse(readFileSync(f, "utf8")) as CacheEntry;
      return daysBetween(entry.created_at);
    } catch {
      return null;
    }
  }

  /** Ignore the TTL — used when the network is down and stale beats nothing. */
  getStale<T>(key: string): { value: T; age_days: number } | null {
    const f = this.file(key);
    if (!existsSync(f)) return null;
    try {
      const entry = JSON.parse(readFileSync(f, "utf8")) as CacheEntry<T>;
      return { value: entry.value, age_days: daysBetween(entry.created_at) };
    } catch {
      return null;
    }
  }

  set<T>(key: string, value: T, meta: { promptVersion: string; modelId: string; inputHash: string }): void {
    const entry: CacheEntry<T> = {
      key,
      created_at: new Date().toISOString(),
      prompt_version: meta.promptVersion,
      model_id: meta.modelId,
      input_hash: meta.inputHash,
      value,
    };
    ensureDir(join(this.paths.cache, key.slice(0, 2)));
    writeJson(this.file(key), entry);
  }

  stats(): { entries: number; bytes: number; oldest_days: number | null } {
    if (!existsSync(this.paths.cache)) return { entries: 0, bytes: 0, oldest_days: null };
    let entries = 0;
    let bytes = 0;
    let oldest: number | null = null;
    const walkDir = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) walkDir(p);
        else if (name.endsWith(".json")) {
          entries++;
          bytes += st.size;
          const age = daysBetween(st.mtime);
          if (oldest === null || age > oldest) oldest = age;
        }
      }
    };
    walkDir(this.paths.cache);
    return { entries, bytes, oldest_days: oldest };
  }

  clear(): number {
    const { entries } = this.stats();
    if (existsSync(this.paths.cache)) rmSync(this.paths.cache, { recursive: true, force: true });
    return entries;
  }
}
