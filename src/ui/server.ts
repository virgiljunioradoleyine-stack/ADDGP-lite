import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { BRAND, PINNED_HOSTS, STEWARD } from "../brand.ts";
import type { Config } from "../config/index.ts";
import type { Paths } from "../util/paths.ts";
import { readJsonl } from "../util/paths.ts";
import { Sovereignty } from "../sovereignty/index.ts";
import type { EgressRecord } from "../sovereignty/gate.ts";
import { loadLatestResult } from "../phases/pipeline.ts";
import { runEvidence } from "../phases/p3-evidence.ts";
import { severityRank, type ScanResult } from "../schemas/index.ts";
import { renderPage } from "./page.ts";

export interface UiServer {
  url: string;
  port: number;
  stop(): void;
}

/**
 * The local UI. It binds to loopback only, serves one self-contained page with no
 * external assets, and exposes read-only JSON built from the same local state the
 * CLI reads. It never calls a model and never writes to the project.
 *
 * Every API request must carry a per-launch token (sent as a header, so a page on
 * another origin cannot read it without a CORS grant this server never gives), and
 * the Host header must be loopback, which defeats DNS rebinding.
 */
export function startUi(opts: { cfg: Config; p: Paths; port?: number }): UiServer {
  const token = randomBytes(24).toString("hex");
  const tokenBytes = new TextEncoder().encode(token);

  const serve = (port: number) =>
    Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch: (req: Request, srv: { port?: number }): Response => handle(req, opts, tokenBytes, srv.port ?? 0),
    });

  let server: ReturnType<typeof serve>;
  try {
    server = serve(opts.port ?? 7417);
  } catch {
    server = serve(0);
  }

  return {
    url: `http://127.0.0.1:${server.port}/#t=${token}`,
    port: server.port ?? 0,
    stop: () => server.stop(true),
  };
}

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
};

function handle(req: Request, opts: { cfg: Config; p: Paths }, token: Uint8Array, port: number): Response {
  const url = new URL(req.url);
  const host = req.headers.get("host") ?? "";
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
    return new Response("Forbidden host", { status: 403, headers: SECURITY_HEADERS });
  }
  if (req.method !== "GET") {
    return new Response("Read-only", { status: 405, headers: SECURITY_HEADERS });
  }

  if (url.pathname === "/") {
    const nonce = randomBytes(16).toString("base64");
    return new Response(renderPage(nonce), {
      headers: {
        ...SECURITY_HEADERS,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; ` +
          `connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      },
    });
  }

  if (!url.pathname.startsWith("/api/")) {
    return new Response("Not found", { status: 404, headers: SECURITY_HEADERS });
  }

  const presented = new TextEncoder().encode(req.headers.get("x-addgp-token") ?? "");
  if (presented.length !== token.length || !timingSafeEqual(presented, token)) {
    return new Response("Missing or wrong session token", { status: 401, headers: SECURITY_HEADERS });
  }

  try {
    const body = api(url.pathname, opts);
    if (body === undefined) return new Response("Not found", { status: 404, headers: SECURITY_HEADERS });
    return new Response(JSON.stringify(body), {
      headers: { ...SECURITY_HEADERS, "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...SECURITY_HEADERS, "Content-Type": "application/json; charset=utf-8" },
    });
  }
}

function api(path: string, { cfg, p }: { cfg: Config; p: Paths }): unknown {
  const latest = (): { runId: string; result: ScanResult } | null => loadLatestResult(p);

  switch (path) {
    case "/api/overview": {
      const run = latest();
      const egress = existsSync(p.egress) ? readJsonl<EgressRecord>(p.egress) : [];
      const gaps = run?.result.gaps ?? [];
      const bySeverity: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
      for (const g of gaps) bySeverity[g.severity] = (bySeverity[g.severity] ?? 0) + 1;
      return {
        tool: { name: BRAND.display, version: BRAND.version, steward: STEWARD.org, disclaimer: BRAND.disclaimerShort },
        project: cfg.project.name,
        profile: cfg.project.profile,
        regions: cfg.regions,
        frameworks: cfg.frameworks,
        sovereignty_level: cfg.sovereignty.level,
        models: cfg.models,
        budget: cfg.budget.per_run_usd,
        pinned_hosts: PINNED_HOSTS,
        run: run
          ? {
              id: run.runId,
              finished_at: run.result.meta.finished_at,
              incomplete: run.result.meta.incomplete,
              phases_run: run.result.meta.phases_run,
              phases_skipped: run.result.meta.phases_skipped,
              cost_usd: run.result.meta.cost_usd,
              corpus_stale: run.result.meta.corpus_stale,
              obligations: run.result.obligations.length,
              disputed: run.result.disputed.length,
              evidence: run.result.evidence?.findings?.length ?? 0,
            }
          : null,
        gaps: { total: gaps.length, by_severity: bySeverity },
        egress: {
          calls: egress.length,
          bytes: egress.reduce((n, r) => n + r.bytes, 0),
          destinations: [...new Set(egress.map((r) => r.destination))],
          last: egress.at(-1)?.ts ?? null,
        },
      };
    }

    case "/api/gaps": {
      const run = latest();
      if (!run) return { run: null, gaps: [] };
      const gaps = [...run.result.gaps].sort(
        (a, b) => severityRank(a.severity) - severityRank(b.severity) || a.id.localeCompare(b.id),
      );
      const obligations = Object.fromEntries(run.result.obligations.map((o) => [o.id, o]));
      return { run: run.runId, gaps, obligations };
    }

    case "/api/evidence": {
      const run = latest();
      if (run?.result.evidence?.findings) {
        return { source: "run", run: run.runId, bundle: run.result.evidence };
      }
      // Phase 3 is local, free and read-only, so with no scan yet we compute it live.
      return { source: "live", run: null, bundle: runEvidence({ cfg, paths: p, scanHistory: false }) };
    }

    case "/api/sovereignty": {
      // Ephemeral map: rendering a preview writes nothing and contacts nothing.
      const sov = Sovereignty.create(cfg, p, undefined, true);
      return { level: sov.level, map_path: p.map, entries: sov.preview(4000) };
    }

    case "/api/egress": {
      const records = existsSync(p.egress) ? readJsonl<EgressRecord>(p.egress) : [];
      return { records: records.slice(-500).reverse(), total: records.length };
    }
  }
  return undefined;
}
