import { PINNED_HOSTS, type PinnedHost } from "../brand.ts";
import { appendJsonl, type Paths } from "../util/paths.ts";
import { findForbidden, lineOf, type DetectorHit } from "./secrets.ts";
import { denyCheck } from "./denylist.ts";
import { payloadText, type SealedPayload } from "./seal.ts";
import { UserError } from "../util/log.ts";

export interface EgressRecord {
  ts: string;
  run_id: string;
  phase: number;
  destination: string;
  bytes: number;
  payload_sha256: string;
  sovereignty_level: number;
  /** real paths, recorded locally so the user can audit what a payload covered */
  files_represented: string[];
  purpose: string;
}

export class EgressBlocked extends UserError {
  constructor(
    message: string,
    readonly hits: DetectorHit[],
    readonly location: string,
  ) {
    super(message, "Nothing was sent. Fix the source of the leak, or add the path to sovereignty.never_send.");
    this.name = "EgressBlocked";
  }
}

export interface GateOptions {
  paths: Paths;
  runId: string;
  phase: number;
  neverSend: readonly string[];
  /** off only inside `sovereignty preview`, which never sends anything anyway */
  record?: boolean;
}

/**
 * §5.4 — every outbound payload passes this gate. It runs against the FINAL
 * serialized payload, after the redactor, and a hit aborts the run rather than
 * cleaning and continuing.
 */
export function gateEgress(
  payload: SealedPayload,
  host: string,
  opts: GateOptions,
): EgressRecord {
  const text = payloadText(payload);

  // 1. deny-list, re-run against the final payload (belt and braces)
  for (const real of payload.represents) {
    const verdict = denyCheck(real, opts.neverSend);
    if (verdict.denied) {
      throw new EgressBlocked(
        `A payload for phase ${opts.phase} represents ${real}, which is on the never-send list (${verdict.reason}: ${verdict.explanation}).`,
        [],
        real,
      );
    }
  }

  // 2. secrets, tokens, emails, phone numbers, national IDs, card numbers
  const hits = findForbidden(text);
  if (hits.length) {
    const detail = hits
      .slice(0, 8)
      .map((h) => `  ${h.label} (${h.rule}) at payload line ${lineOf(text, h.index)} — ${h.excerpt}`)
      .join("\n");
    throw new EgressBlocked(
      `Egress gate blocked a phase-${opts.phase} payload: ${hits.length} forbidden pattern(s) survived redaction.\n${detail}` +
        (payload.represents.length
          ? `\n\nPayload covers: ${payload.represents.slice(0, 10).join(", ")}${payload.represents.length > 10 ? ` (+${payload.represents.length - 10} more)` : ""}`
          : ""),
      hits,
      payload.represents[0] ?? "(no file)",
    );
  }

  // 3. destination must be one of exactly three pinned hostnames
  if (!isPinnedHost(host)) {
    throw new EgressBlocked(
      `Egress gate blocked a connection to ${host}. Only ${PINNED_HOSTS.join(", ")} are permitted. This is a bug, not a configuration problem.`,
      [],
      host,
    );
  }

  // 4. ledger
  const record: EgressRecord = {
    ts: new Date().toISOString(),
    run_id: opts.runId,
    phase: opts.phase,
    destination: host,
    bytes: payload.byte_count,
    payload_sha256: payload.payload_hash,
    sovereignty_level: payload.level,
    files_represented: [...payload.represents],
    purpose: payload.purpose,
  };
  if (opts.record !== false) appendJsonl(opts.paths.egress, record);
  return record;
}

export function isPinnedHost(host: string): host is PinnedHost {
  return (PINNED_HOSTS as readonly string[]).includes(host);
}

/** Assert a URL points at a pinned host. Called before any fetch is constructed. */
export function assertPinnedUrl(url: string): string {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") {
      throw new EgressBlocked(`Refusing a non-HTTPS destination: ${url}`, [], url);
    }
    host = u.hostname;
  } catch (e) {
    if (e instanceof EgressBlocked) throw e;
    throw new EgressBlocked(`Refusing a malformed destination: ${url}`, [], url);
  }
  if (!isPinnedHost(host)) {
    throw new EgressBlocked(
      `Egress gate blocked a connection to ${host}. Only ${PINNED_HOSTS.join(", ")} are permitted.`,
      [],
      host,
    );
  }
  return host;
}
