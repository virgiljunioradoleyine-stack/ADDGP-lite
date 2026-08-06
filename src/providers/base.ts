import type { Config } from "../config/index.ts";
import { getKey } from "../keys/index.ts";
import type { Paths } from "../util/paths.ts";
import { log, UserError, redactValue } from "../util/log.ts";
import { sleep } from "../util/time.ts";
import { assertPinnedUrl, gateEgress } from "../sovereignty/gate.ts";
import { payloadText, type SealedPayload } from "../sovereignty/seal.ts";
import {
  BudgetMeter, costOf, estimateTokens, priceFor,
  type PriceEntry, type Seat, type Usage,
} from "./budget.ts";
import { Cache, cacheKey } from "./cache.ts";
import { cassetteKey, cassetteMode, readCassette, writeCassette, CassetteMissing } from "./cassette.ts";

export interface Citation {
  title?: string;
  url: string;
}

export interface ProviderResponse {
  text: string;
  usage: Usage;
  model: string;
  /** the research seat's models return these; the corpus phase requires them */
  citations: Citation[];
  cached: boolean;
  cost_usd: number;
  /** true when cost came from the vendor's own accounting rather than an estimate */
  cost_reported: boolean;
}

export interface CallOptions {
  phase: number;
  /** version identifier of the prompt file, hashed into the cache key */
  promptVersion: string;
  purpose: string;
  temperature?: number;
  maxTokens?: number;
  /** cache TTL in days; 0 disables caching for this call */
  ttlDays?: number;
  /** force a fresh call even when cached (used by second-pass verification) */
  bypassCache?: boolean;
  /** extra params folded into the cache key */
  params?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface ProviderContext {
  cfg: Config;
  paths: Paths;
  runId: string;
  meter: BudgetMeter;
  cache: Cache;
  offline: boolean;
  pricing?: Record<string, PriceEntry>;
}

export class ProviderUnavailable extends UserError {
  constructor(
    readonly seat: Seat,
    message: string,
  ) {
    super(message);
    this.name = "ProviderUnavailable";
  }
}

export class ProviderSkipped extends Error {
  constructor(
    readonly seat: Seat,
    readonly reason: string,
  ) {
    super(reason);
    this.name = "ProviderSkipped";
  }
}

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 800;

/**
 * §4 hard rule: no provider client may accept a raw payload.
 *
 * `call` takes a SealedPayload and nothing else. There is no string overload, and
 * SealedPayload carries a unique-symbol brand that only `sovereignty/seal.ts` can
 * attach — so `client.call("raw code")` does not compile, which is exactly what
 * milestone 3 requires.
 */
export abstract class SeatClient {
  abstract readonly seat: Seat;
  abstract readonly host: string;

  constructor(
    protected readonly ctx: ProviderContext,
    readonly modelId: string,
  ) {}

  protected abstract buildRequest(
    payload: SealedPayload,
    opts: CallOptions,
    apiKey: string,
  ): { url: string; init: RequestInit };

  protected abstract parseResponse(
    json: unknown,
  ): Omit<ProviderResponse, "cached" | "cost_usd"> & { reported_cost?: number };

  abstract listModels(): Promise<string[]>;

  /** §5.5 — the most protective data-handling option the vendor exposes. */
  abstract privacyPosture(): { control: string; applied: boolean; note: string };

  protected apiKey(): string {
    const key = getKey("openrouter");
    if (!key) {
      throw new ProviderUnavailable(
        this.seat,
        "No OpenRouter API key found. Set it with `addgp-lite keys set` or $OPENROUTER_API_KEY.",
      );
    }
    redactValue(key);
    return key;
  }

  private price(): PriceEntry {
    return priceFor(this.modelId, this.ctx.pricing);
  }

  estimateCost(payload: SealedPayload, maxTokens = 2000): number {
    const inTok = estimateTokens(payloadText(payload));
    return costOf({ input_tokens: inTok, output_tokens: maxTokens }, this.price());
  }

  /**
   * The single entry point. Order matters and is enforced here:
   *   cache → cassette → budget precheck → egress gate → pinned host → request → meter.
   */
  async call(payload: SealedPayload, opts: CallOptions): Promise<ProviderResponse> {
    const key = cacheKey({
      promptVersion: opts.promptVersion,
      inputHash: payload.payload_hash,
      modelId: this.modelId,
      params: {
        temperature: opts.temperature ?? 0,
        maxTokens: opts.maxTokens ?? 4000,
        ...(opts.params ?? {}),
      },
    });
    const ttl = opts.ttlDays ?? 7;

    if (!opts.bypassCache && ttl > 0) {
      const hit = this.ctx.cache.get<ProviderResponse>(key, ttl);
      if (hit) {
        this.ctx.meter.record(this.seat, this.modelId, opts.phase, hit.usage, 0, true, false);
        log.debug(`${this.seat}: cache hit for ${opts.purpose}`);
        return { ...hit, cached: true, cost_usd: 0 };
      }
    }

    const mode = cassetteMode();
    const ckey = cassetteKey(this.seat, this.modelId, payload.payload_hash);
    if (mode === "replay") {
      const taped = readCassette(ckey);
      if (!taped) throw new CassetteMissing(ckey, `${this.seat}/${opts.purpose}`);
      this.ctx.meter.record(this.seat, this.modelId, opts.phase, taped.usage, 0, true, false);
      return { ...taped, cached: true, cost_usd: 0 };
    }

    if (this.ctx.offline) {
      throw new ProviderSkipped(this.seat, "running with --offline");
    }

    const estimate = this.estimateCost(payload, opts.maxTokens ?? 2000);
    if (this.ctx.meter.precheck(this.seat, estimate) === "skip") {
      throw new ProviderSkipped(this.seat, "budget cap reached (degrade mode)");
    }

    // Nothing reaches the network without passing the gate first.
    gateEgress(payload, this.host, {
      paths: this.ctx.paths,
      runId: this.ctx.runId,
      phase: opts.phase,
      neverSend: this.ctx.cfg.sovereignty.never_send,
    });

    const response = await this.request(payload, opts);
    // Prefer the vendor's own cost accounting; fall back to the price table.
    const reported = response.reported_cost;
    const cost = typeof reported === "number" && reported >= 0 ? reported : costOf(response.usage, this.price());
    const full: ProviderResponse = {
      text: response.text,
      usage: response.usage,
      model: response.model,
      citations: response.citations,
      cached: false,
      cost_usd: cost,
      cost_reported: typeof reported === "number",
    };

    this.ctx.meter.record(this.seat, this.modelId, opts.phase, response.usage, cost, false, full.cost_reported);
    if (ttl > 0) {
      this.ctx.cache.set(key, full, {
        promptVersion: opts.promptVersion,
        modelId: this.modelId,
        inputHash: payload.payload_hash,
      });
    }
    if (mode === "record") writeCassette(ckey, full, `${this.seat}/${opts.purpose}`);
    return full;
  }

  /** Retry with exponential backoff and jitter; honour Retry-After (§13). */
  private async request(
    payload: SealedPayload,
    opts: CallOptions,
  ): Promise<Omit<ProviderResponse, "cached" | "cost_usd"> & { reported_cost?: number }> {
    const apiKey = this.apiKey();
    const { url, init } = this.buildRequest(payload, opts, apiKey);
    assertPinnedUrl(url);

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(url, { ...init, signal: opts.signal });
        if (res.ok) {
          const json = (await res.json()) as unknown;
          return this.parseResponse(json);
        }

        const body = await res.text().catch(() => "");
        // 4xx other than 408/429 will not become true by trying again
        if (res.status < 500 && res.status !== 429 && res.status !== 408) {
          throw new ProviderUnavailable(
            this.seat,
            `OpenRouter returned ${res.status} for the ${this.seat} seat (${this.modelId}): ${truncate(body, 400)}`,
          );
        }
        // A non-idempotent budget-consuming call is never retried past the limit.
        if (attempt === MAX_ATTEMPTS) {
          throw new ProviderUnavailable(
            this.seat,
            `OpenRouter failed after ${MAX_ATTEMPTS} attempts for the ${this.seat} seat (last status ${res.status}).`,
          );
        }
        const retryAfter = Number(res.headers.get("retry-after"));
        const delay =
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt);
        log.debug(`${this.seat}: ${res.status}, retrying in ${Math.round(delay)}ms (attempt ${attempt})`);
        await sleep(delay);
        continue;
      } catch (e) {
        if (e instanceof ProviderUnavailable) throw e;
        lastError = e;
        if (attempt === MAX_ATTEMPTS) break;
        const delay = backoff(attempt);
        log.debug(`${this.seat}: ${String(e)}; retrying in ${Math.round(delay)}ms`);
        await sleep(delay);
      }
    }
    throw new ProviderUnavailable(
      this.seat,
      `OpenRouter is unreachable: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }

  protected async getJson(url: string, headers: Record<string, string>): Promise<unknown> {
    assertPinnedUrl(url);
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new ProviderUnavailable(
        this.seat,
        `OpenRouter model list returned ${res.status}: ${truncate(await res.text().catch(() => ""), 200)}`,
      );
    }
    return res.json();
  }
}

function backoff(attempt: number): number {
  const base = BASE_DELAY_MS * Math.pow(2, attempt - 1);
  return base + Math.random() * base * 0.3; // jitter
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
