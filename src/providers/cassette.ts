import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "../util/hash.ts";
import { ensureDir, writeJson } from "../util/paths.ts";
import type { ProviderResponse } from "./base.ts";

/**
 * §15/16 — model cassettes recorded once, replayed in CI, so no CI run spends
 * money and `scan` is reproducible offline.
 *
 * ADDGP_CASSETTES=<dir> ADDGP_CASSETTE_MODE=record|replay
 */
export type CassetteMode = "off" | "record" | "replay";

export function cassetteMode(): CassetteMode {
  const m = process.env.ADDGP_CASSETTE_MODE;
  if (m === "record" || m === "replay") return m;
  return "off";
}

export function cassetteDir(): string {
  return process.env.ADDGP_CASSETTES ?? join(process.cwd(), "tests", "golden", "cassettes");
}

export function cassetteKey(provider: string, model: string, payloadHash: string): string {
  return sha256(`${provider}|${model}|${payloadHash}`).slice(0, 32);
}

function cassetteFile(key: string): string {
  return join(cassetteDir(), `${key}.json`);
}

export function readCassette(key: string): ProviderResponse | null {
  const f = cassetteFile(key);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf8")) as ProviderResponse;
  } catch {
    return null;
  }
}

export function writeCassette(key: string, response: ProviderResponse, label: string): void {
  ensureDir(cassetteDir());
  writeJson(cassetteFile(key), { ...response, _label: label });
}

export class CassetteMissing extends Error {
  constructor(key: string, label: string) {
    super(
      `No cassette for ${label} (key ${key}). Record one with ADDGP_CASSETTE_MODE=record, ` +
        `or run with --offline to skip model-dependent phases.`,
    );
    this.name = "CassetteMissing";
  }
}
