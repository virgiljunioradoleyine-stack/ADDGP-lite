import type { Config } from "../config/index.ts";
import { appendJsonl, type Paths } from "../util/paths.ts";
import { UserError, log } from "../util/log.ts";

/**
 * The three seats of §2. They remain three distinct seats — deliberately
 * different model families, so nothing marks its own homework — but they are all
 * reached through one OpenRouter key.
 */
export type Seat = "research" | "security" | "architect";
export const SEATS: Seat[] = ["research", "security", "architect"];

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

export interface PriceEntry {
  input_per_mtok: number;
  output_per_mtok: number;
}

/**
 * Fallback prices per million tokens, USD, used only for the `--dry-run`
 * projection and the budget precheck. Actual spend comes from OpenRouter's own
 * `usage.cost` on every response, so the ROI report never reports a guess as a
 * fact. `doctor` refreshes these from the live model list into
 * `.addgp/pricing.json`.
 */
export const DEFAULT_PRICING: Record<string, PriceEntry> = {
  "*": { input_per_mtok: 3, output_per_mtok: 15 },
};

export function priceFor(modelId: string, overrides: Record<string, PriceEntry> = {}): PriceEntry {
  const table = { ...DEFAULT_PRICING, ...overrides };
  return table[modelId] ?? table["*"] ?? { input_per_mtok: 0, output_per_mtok: 0 };
}

export function costOf(usage: Usage, price: PriceEntry): number {
  return (
    (usage.input_tokens / 1_000_000) * price.input_per_mtok +
    (usage.output_tokens / 1_000_000) * price.output_per_mtok
  );
}

export class BudgetExceeded extends UserError {
  constructor(seat: Seat, spent: number, cap: number) {
    super(
      `Budget stop: the ${seat} seat reached $${spent.toFixed(4)} of its $${cap.toFixed(2)} per-run cap.`,
      "Raise budget.per_run_usd in your config, or set budget.on_exceed to warn or degrade. Partial results have been written and marked incomplete.",
    );
    this.name = "BudgetExceeded";
  }
}

export interface SpendRecord {
  ts: string;
  run_id: string;
  seat: Seat;
  model: string;
  phase: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  /** true when the figure came from OpenRouter rather than the local estimate */
  cost_reported: boolean;
  cached: boolean;
}

/**
 * §13 — live meter per seat, hard stop at budget. `degrade` lets the run continue
 * without that seat rather than dying, which matters on a metered connection
 * where a re-run is expensive.
 */
export class BudgetMeter {
  private spent: Record<Seat, number> = { research: 0, security: 0, architect: 0 };
  private calls: Record<Seat, number> = { research: 0, security: 0, architect: 0 };
  private degraded = new Set<Seat>();
  private records: SpendRecord[] = [];

  constructor(
    private readonly cfg: Config,
    private readonly paths: Paths,
    private readonly runId: string,
  ) {}

  cap(seat: Seat): number {
    return this.cfg.budget.per_run_usd[seat];
  }

  spentOn(seat: Seat): number {
    return this.spent[seat];
  }

  total(): number {
    return Object.values(this.spent).reduce((a, b) => a + b, 0);
  }

  isDegraded(seat: Seat): boolean {
    return this.degraded.has(seat);
  }

  all(): Record<Seat, number> {
    return { ...this.spent };
  }

  callCounts(): Record<Seat, number> {
    return { ...this.calls };
  }

  history(): SpendRecord[] {
    return [...this.records];
  }

  /** Called before a request. Throws or degrades when the cap is already reached. */
  precheck(seat: Seat, estimatedCost: number): "ok" | "skip" {
    if (this.degraded.has(seat)) return "skip";
    const cap = this.cap(seat);
    if (cap <= 0) return "ok";
    if (this.spent[seat] + estimatedCost <= cap) return "ok";

    switch (this.cfg.budget.on_exceed) {
      case "warn":
        log.warn(
          `Budget warning: the ${seat} seat is at $${this.spent[seat].toFixed(4)} of $${cap.toFixed(2)}; continuing because budget.on_exceed is "warn".`,
        );
        return "ok";
      case "degrade":
        if (!this.degraded.has(seat)) {
          this.degraded.add(seat);
          log.warn(
            `Budget reached for the ${seat} seat ($${cap.toFixed(2)}). Degrading: remaining ${seat} work will be skipped and reported as not checked.`,
          );
        }
        return "skip";
      default:
        throw new BudgetExceeded(seat, this.spent[seat], cap);
    }
  }

  record(
    seat: Seat,
    model: string,
    phase: number,
    usage: Usage,
    cost: number,
    cached: boolean,
    costReported: boolean,
  ): void {
    if (!cached) {
      this.spent[seat] += cost;
      this.calls[seat] += 1;
    }
    const rec: SpendRecord = {
      ts: new Date().toISOString(),
      run_id: this.runId,
      seat,
      model,
      phase,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cost_usd: cached ? 0 : cost,
      cost_reported: costReported && !cached,
      cached,
    };
    this.records.push(rec);
    appendJsonl(this.paths.cost, rec);
  }
}

/** Rough token estimate for dry-run projections. Deliberately conservative. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}
