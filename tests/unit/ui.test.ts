import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadConfig } from "../../src/config/index.ts";
import { paths } from "../../src/util/paths.ts";
import { startUi } from "../../src/ui/server.ts";

const FIXTURE = join(import.meta.dir, "..", "fixtures", "nextjs-supabase-llm");
const p = paths(FIXTURE);
const cfg = loadConfig(p.config);
const ui = startUi({ cfg, p, port: 0 });
const base = `http://127.0.0.1:${ui.port}`;
const token = new URL(ui.url).hash.replace("#t=", "");

afterAll(() => ui.stop());

const get = (path: string, headers: Record<string, string> = {}) =>
  fetch(base + path, { headers: { "x-addgp-token": token, ...headers } });

describe("local UI — who can talk to it", () => {
  test("binds to loopback and hands out a long random token", () => {
    expect(ui.url.startsWith("http://127.0.0.1:")).toBe(true);
    expect(token).toMatch(/^[0-9a-f]{48}$/);
  });

  test("the API refuses a request with no token or the wrong token", async () => {
    expect((await fetch(base + "/api/overview")).status).toBe(401);
    expect((await get("/api/overview", { "x-addgp-token": "0".repeat(48) })).status).toBe(401);
  });

  test("a non-loopback Host header is refused, which defeats DNS rebinding", async () => {
    expect((await get("/api/overview", { host: `evil.example:${ui.port}` })).status).toBe(403);
  });

  test("it is read-only: anything but GET is refused", async () => {
    const r = await fetch(base + "/api/overview", { method: "POST", headers: { "x-addgp-token": token } });
    expect(r.status).toBe(405);
  });

  test("no CORS grant is ever made, so another origin cannot read the API", async () => {
    const r = await get("/api/overview", { origin: "https://evil.example" });
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("local UI — the page itself", () => {
  test("ships a strict CSP with a per-request script nonce", async () => {
    const r = await fetch(base + "/");
    const csp = r.headers.get("content-security-policy") ?? "";
    expect(r.status).toBe(200);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toMatch(/script-src 'nonce-[A-Za-z0-9+/=]+'/);
    expect(csp).toContain("frame-ancestors 'none'");
  });

  test("loads nothing from the network: no external scripts, styles or fonts", async () => {
    const html = await (await fetch(base + "/")).text();
    expect(html).not.toMatch(/<(script|link)[^>]+(src|href)=["']https?:/i);
    expect(html).not.toMatch(/@import|fonts\.googleapis|cdn/i);
  });
});

describe("local UI — what it shows", () => {
  test("with no scan, overview says so instead of implying a clean result", async () => {
    const o = (await (await get("/api/overview")).json()) as { run: unknown; pinned_hosts: string[] };
    expect(o.run).toBeNull();
    expect(o.pinned_hosts).toEqual(["openrouter.ai"]);
  });

  test("local findings are computed live, for free, when no scan exists", async () => {
    const e = (await (await get("/api/evidence")).json()) as { source: string; bundle: { findings: { rule_id: string }[] } };
    expect(e.source).toBe("live");
    expect(e.bundle.findings.some((f) => f.rule_id === "iac.privileged_key_in_client")).toBe(true);
  });

  test("the sovereignty view is the redacted form, never the source", async () => {
    const s = (await (await get("/api/sovereignty")).json()) as {
      entries: { path: string; status: string; preview?: string }[];
    };
    const supabase = s.entries.find((e) => e.path === "lib/supabase.ts");
    expect(supabase?.status).toBe("sent");
    expect(supabase?.preview).toContain("tbl_");
    expect(supabase?.preview).not.toContain("patients");
    expect(s.entries.find((e) => e.path === "addgp-lite.yaml")?.status).toBe("denied");
  });
});
