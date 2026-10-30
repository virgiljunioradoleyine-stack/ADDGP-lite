import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { PseudonymMap } from "../../src/sovereignty/pseudonym.ts";
import { rehydrate, reseal } from "../../src/sovereignty/rehydrate.ts";
import { Sovereignty } from "../../src/sovereignty/index.ts";
import { loadConfig } from "../../src/config/index.ts";
import { paths } from "../../src/util/paths.ts";
import { runEvidence } from "../../src/phases/p3-evidence.ts";
import { summariseEvidence } from "../../src/phases/p1-profile.ts";

describe("reseal — rehydrated model output cannot carry real names back out", () => {
  test("real names in re-sent text go back to their pseudonyms", () => {
    const map = PseudonymMap.ephemeral("t");
    const fn = map.symbol("getPatient", "fn");
    const tbl = map.symbol("patients", "tbl");
    const path = map.pathPseudonym("lib/supabase.ts");

    const modelSaid = `${fn} reads ${tbl} in ${path} and logs it.`;
    const userReads = rehydrate(modelSaid, map);
    expect(userReads).toBe("getPatient reads patients in lib/supabase.ts and logs it.");

    const resent = reseal(userReads, map);
    expect(resent).toBe(modelSaid);
    for (const real of ["getPatient", "patients", "lib/supabase.ts"]) expect(resent).not.toContain(real);
  });

  test("only whole tokens are replaced, and very short names are left alone", () => {
    const map = PseudonymMap.ephemeral("t");
    map.symbol("user", "var");
    map.symbol("db", "var");
    const out = reseal("username and user_id stay; user goes; db stays", map);
    expect(out).toContain("username");
    expect(out).toContain("user_id");
    expect(out).not.toMatch(/\buser goes/);
    expect(out).toContain("db stays");
  });
});

describe("evidence summary — the text phases 1, 4 and 5 send", () => {
  const fixture = join(import.meta.dir, "..", "fixtures", "nextjs-supabase-llm");
  const p = paths(fixture);
  const cfg = loadConfig(p.config);
  const sov = Sovereignty.create(cfg, p, undefined, true);
  const text = summariseEvidence(runEvidence({ cfg, paths: p, scanHistory: false }), (x) => sov.sealPath(x));

  test("carries no real file path from the repository", () => {
    for (const real of ["lib/supabase.ts", "supabase/schema.sql", "app/api/chat/route.ts"]) {
      expect(text).not.toContain(real);
    }
    expect(text).toMatch(/mod_[a-z0-9]+\/svc_[a-z0-9]+\.ts/);
  });

  test("carries no symbol or table name, only conclusions", () => {
    expect(text).not.toContain("patients");
    expect(text).not.toContain("getPatient");
  });
});
