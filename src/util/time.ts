export const nowIso = () => new Date().toISOString();

export function daysBetween(a: string | Date, b: string | Date = new Date()): number {
  const t1 = typeof a === "string" ? Date.parse(a) : a.getTime();
  const t2 = typeof b === "string" ? Date.parse(b) : b.getTime();
  if (Number.isNaN(t1) || Number.isNaN(t2)) return Number.POSITIVE_INFINITY;
  return Math.abs(t2 - t1) / 86_400_000;
}

export function isStale(retrievedAt: string | undefined, ttlDays: number): boolean {
  if (!retrievedAt) return true;
  return daysBetween(retrievedAt) > ttlDays;
}

export function humanDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  if (m < 60) return `${m}m ${rem}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Deterministic run id: sortable, no randomness needed for reproducibility. */
export function newRunId(d = new Date()): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
}
