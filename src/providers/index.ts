import { join } from "node:path";
import type { Config } from "../config/index.ts";
import type { Paths } from "../util/paths.ts";
import { readJson } from "../util/paths.ts";
import { BudgetMeter, type PriceEntry, type Seat } from "./budget.ts";
import { Cache } from "./cache.ts";
import type { ProviderContext } from "./base.ts";
import { OpenRouterClient } from "./openrouter.ts";

export * from "./base.ts";
export * from "./budget.ts";
export { Cache, cacheKey } from "./cache.ts";
export { cassetteMode } from "./cassette.ts";
export { OpenRouterClient, type ORModel } from "./openrouter.ts";

export interface Providers {
  research: OpenRouterClient;
  security: OpenRouterClient;
  architect: OpenRouterClient;
  meter: BudgetMeter;
  cache: Cache;
  ctx: ProviderContext;
  bySeat(seat: Seat): OpenRouterClient;
}

export function createProviders(
  cfg: Config,
  paths: Paths,
  runId: string,
  offline = false,
): Providers {
  const meter = new BudgetMeter(cfg, paths, runId);
  const cache = new Cache(paths);
  const pricing = readJson<Record<string, PriceEntry>>(join(paths.state, "pricing.json"), {});
  const ctx: ProviderContext = { cfg, paths, runId, meter, cache, offline, pricing };

  const research = new OpenRouterClient(ctx, cfg.models.research.id, "research");
  const security = new OpenRouterClient(ctx, cfg.models.security.id, "security");
  const architect = new OpenRouterClient(ctx, cfg.models.architect.id, "architect");

  return {
    research,
    security,
    architect,
    meter,
    cache,
    ctx,
    bySeat(seat: Seat) {
      return seat === "research" ? research : seat === "security" ? security : architect;
    },
  };
}

/** Parse a JSON object or array out of a model response that may wrap it in prose. */
export function extractJson<T = unknown>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text].filter((c): c is string => !!c);
  for (const c of candidates) {
    const trimmed = c.trim();
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      /* fall through to locating a balanced object or array */
    }
    const start = trimmed.search(/[[{]/);
    if (start === -1) continue;
    const open = trimmed[start]!;
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i]!;
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(trimmed.slice(start, i + 1)) as T;
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}
