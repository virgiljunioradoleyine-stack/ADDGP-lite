import { appendJsonl, readJsonl, type Paths } from "./paths.ts";

export type PhaseId = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface JournalEntry {
  ts: string;
  run_id: string;
  phase: PhaseId;
  event: "start" | "done" | "skip" | "fail" | "note";
  detail?: string;
  artifact?: string;
  duration_ms?: number;
}

/**
 * Append-only phase journal. Every phase is resumable from this, because the
 * connection will drop mid-run (§1.3).
 */
export class Journal {
  constructor(
    private readonly p: Paths,
    readonly runId: string,
  ) {}

  write(e: Omit<JournalEntry, "ts" | "run_id">): void {
    appendJsonl(this.p.journal, { ts: new Date().toISOString(), run_id: this.runId, ...e });
  }

  entries(runId?: string): JournalEntry[] {
    const all = readJsonl<JournalEntry>(this.p.journal);
    return runId ? all.filter((e) => e.run_id === runId) : all;
  }

  /** Phases already completed in this run — used by --resume. */
  completed(runId = this.runId): Set<PhaseId> {
    const done = new Set<PhaseId>();
    for (const e of this.entries(runId)) if (e.event === "done") done.add(e.phase);
    return done;
  }

  lastRunId(): string | null {
    const all = this.entries();
    return all.length ? all[all.length - 1]!.run_id : null;
  }
}
