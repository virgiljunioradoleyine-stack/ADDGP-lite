import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BRAND, OPENROUTER, PINNED_HOSTS } from "../../brand.ts";
import { defaultConfig, loadConfig, saveConfig, type Config } from "../../config/index.ts";
import {
  ENV_VAR, getKey, keyLocations, keychainName, promptHidden, promptLine, removeKey, setKey,
} from "../../keys/index.ts";
import { paths as makePaths, readJsonl, writeJson, writeOut, ensureDir, readJson , readBytes } from "../../util/paths.ts";
import { log, UserError, color } from "../../util/log.ts";
import { sha256 } from "../../util/hash.ts";
import { isGitRepo } from "../../util/git.ts";
import { listPackIds, getPack, regionPacks, frameworkPacks } from "../../regions/index.ts";
import { createProviders } from "../../providers/index.ts";
import { Cache } from "../../providers/cache.ts";
import type { SpendRecord } from "../../providers/budget.ts";
import { EMBED_VERSION, EMBED_BUILT_AT } from "../../generated/embedded.ts";
import { heading, kv, table, ok, bad, warn, info, bytes, severityColor } from "../ui.ts";
import type { ParsedArgs } from "../args.ts";
import { flagBool, flagString } from "../args.ts";

/* ───────────────────────────── init ───────────────────────────── */

export async function cmdInit(args: ParsedArgs): Promise<number> {
  const root = process.cwd();
  const p = makePaths(root);
  const nonInteractive = flagBool(args.flags, "yes") || !process.stdin.isTTY;

  heading(`${BRAND.display} — setup`);
  log.raw(`  ${BRAND.tagline}`);
  log.raw(color.gray(`  Everything is embedded. This works with the network off.`));
  log.blank();

  if (existsSync(p.config) && !flagBool(args.flags, "force")) {
    throw new UserError(
      `${BRAND.configFile} already exists.`,
      `Edit it directly, or re-run with --force to start over.`,
    );
  }

  /* project name */
  const defaultName = basenameOf(root);
  const name = nonInteractive
    ? (flagString(args.flags, "name") ?? defaultName)
    : promptLine(`  Project name [${defaultName}]: `, defaultName);

  /* regions */
  log.blank();
  log.raw(color.bold("  Regions"));
  log.raw(color.gray("  Packs shipped in this binary. A regime with no pack is not audited, and says so."));
  log.blank();
  for (const pack of regionPacks()) {
    log.raw(`    ${pack.id.padEnd(11)} ${pack.name}${pack.depth === "deep" ? color.green("  (deep)") : ""}`);
  }
  log.blank();
  log.raw(color.bold("  Cross-cutting frameworks"));
  for (const pack of frameworkPacks()) {
    log.raw(`    ${pack.id.padEnd(11)} ${pack.name}`);
  }
  log.blank();

  const regionsInput = nonInteractive
    ? (flagString(args.flags, "regions") ?? "gh,ng,eu")
    : promptLine(`  Regions, comma-separated [gh,ng,eu]: `, "gh,ng,eu");
  const regions = regionsInput.split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = regions.filter((r) => !listPackIds().includes(r));
  if (unknown.length) {
    throw new UserError(
      `No pack ships for: ${unknown.join(", ")}`,
      `Available: ${listPackIds().join(", ")}. The tool will not guess at a regime it has no sources for.`,
    );
  }

  /* sovereignty */
  log.blank();
  log.raw(color.bold("  Sovereignty level"));
  log.raw(`    0  structural    ${color.gray("only shape leaves: AST skeletons, call edges, dependency names")}`);
  log.raw(`    1  pseudonymised ${color.gray("structure and logic leave, identity does not  (default)")}`);
  log.raw(`    2  verbatim      ${color.gray("opt-in, per-path allowlist only")}`);
  log.blank();
  const levelInput = nonInteractive
    ? (flagString(args.flags, "sovereignty") ?? "1")
    : promptLine(`  Level [1]: `, "1");
  const level = Number(levelInput);
  if (![0, 1, 2].includes(level)) throw new UserError(`Sovereignty level must be 0, 1 or 2.`);

  /* profile */
  const profileInput = nonInteractive
    ? (flagString(args.flags, "profile") ?? "student")
    : promptLine(`  Profile — student | indie | company [student]: `, "student");
  if (!["student", "indie", "company"].includes(profileInput)) {
    throw new UserError(`Profile must be student, indie or company.`);
  }

  /* build config */
  const cfg = defaultConfig(name, regions);
  cfg.sovereignty.level = level as 0 | 1 | 2;
  cfg.project.profile = profileInput as Config["project"]["profile"];
  const frameworks = regions.filter((r) => frameworkPacks().some((f) => f.id === r));
  cfg.regions = regions.filter((r) => regionPacks().some((x) => x.id === r));
  cfg.frameworks = [...new Set([...cfg.frameworks, ...frameworks])];
  if (!cfg.regions.length) {
    throw new UserError("At least one region pack must be selected.");
  }
  saveConfig(p.config, cfg);
  log.blank();
  log.raw(ok(`Wrote ${BRAND.configFile}`));

  /* description */
  ensureDir(p.state);
  if (!existsSync(p.description)) {
    writeOut(p.description, DESCRIPTION_TEMPLATE(name));
    log.raw(ok(`Wrote ${cfg.project.description_file} — fill this in before scanning`));
  }

  /* gitignore */
  ensureGitignore(root);

  /* key */
  log.blank();
  log.raw(color.bold("  API key"));
  log.raw(
    color.gray(
      `  One OpenRouter key serves all three seats. Get one at https://openrouter.ai/keys —\n` +
        `  you pay OpenRouter directly, and ${BRAND.name} takes nothing.`,
    ),
  );
  log.blank();

  if (getKey("openrouter")) {
    log.raw(ok(`OpenRouter key already available (${keyLocations()[0]!.detail}).`));
  } else if (nonInteractive) {
    log.raw(warn(`No key set. Set $${ENV_VAR.openrouter} or run \`${BRAND.name} keys set\`.`));
  } else {
    const key = promptHidden(`  Paste your OpenRouter key (or press enter to skip): `);
    if (key) {
      const source = setKey("openrouter", key);
      log.raw(ok(`Key stored in ${source === "keychain" ? keychainName() : "an encrypted file"}.`));
    } else {
      log.raw(info(`Skipped. Set $${ENV_VAR.openrouter} or run \`${BRAND.name} keys set\` later.`));
    }
  }

  log.blank();
  log.raw(color.bold("  Next"));
  log.raw(`    1. Describe your system in ${cfg.project.description_file}`);
  log.raw(`    2. ${BRAND.name} sovereignty preview   ${color.gray("# exactly what would leave this machine")}`);
  log.raw(`    3. ${BRAND.name} doctor                ${color.gray("# validate keys, model ids, budgets")}`);
  log.raw(`    4. ${BRAND.name} scan --dry-run        ${color.gray("# projected spend, no calls")}`);
  log.raw(`    5. ${BRAND.name} scan`);
  log.blank();
  return 0;
}

const DESCRIPTION_TEMPLATE = (name: string) => `# ${name}

<!--
Describe your system in plain English. Two or three paragraphs is plenty.
The more honest this is, the more useful the scan: contradictions between what
you write here and what your code does are the highest-value findings this tool
produces, and they are found before anything is spent.

Worth covering:
  - What does the system do, and for whom?
  - What data does it hold about people? Be specific: emails, phone numbers,
    national ID numbers, health data, location, payment details.
  - Where are your users, and where is the data stored?
  - Does anything make an automated decision about a person?
  - Do you call an AI or inference vendor, and with what data?
  - Who else receives the data? Analytics, payments, email, hosting.
  - Is this in production, or pre-launch?
-->

## What it does

## What data it holds

## Where users and data are

## Third parties and AI
`;

function basenameOf(dir: string): string {
  const parts = dir.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? "project";
}

function ensureGitignore(root: string): void {
  const file = join(root, ".gitignore");
  const needed = [BRAND.stateDir + "/", BRAND.outDir + "/"];
  let content = existsSync(file) ? readFileSync(file, "utf8") : "";
  const missing = needed.filter((n) => !content.split("\n").some((l) => l.trim() === n.trim()));
  if (!missing.length) return;
  if (content && !content.endsWith("\n")) content += "\n";
  content += `\n# ${BRAND.display}: local state (pseudonym map, egress ledger, cache) and generated reports\n`;
  content += missing.join("\n") + "\n";
  writeOut(file, content);
  log.raw(ok(`Added ${missing.join(", ")} to .gitignore`));
}

/* ───────────────────────────── doctor ───────────────────────────── */

export async function cmdDoctor(args: ParsedArgs): Promise<number> {
  const root = process.cwd();
  const p = makePaths(root);
  const localOnly = flagBool(args.flags, "local");
  const privacy = flagBool(args.flags, "privacy");
  let failures = 0;
  const fail = (msg: string) => {
    log.raw(bad(msg));
    failures++;
  };

  heading(`${BRAND.display} doctor`);

  /* config */
  let cfg: Config | null = null;
  try {
    cfg = loadConfig(p.config);
    log.raw(ok(`${BRAND.configFile} is valid`));
  } catch (e) {
    fail(e instanceof UserError ? e.message.split("\n")[0]! : String(e));
    log.raw(info(`Run \`${BRAND.name} init\` first.`));
    return 1;
  }

  /* packs */
  const missing = [...cfg.regions, ...cfg.frameworks].filter((r) => !listPackIds().includes(r));
  if (missing.length) fail(`No pack ships for: ${missing.join(", ")} — those regimes will not be audited`);
  else log.raw(ok(`${cfg.regions.length} region pack(s) + ${cfg.frameworks.length} framework pack(s) available offline`));
  log.raw(info(`Packs embedded at build time (v${EMBED_VERSION}, ${EMBED_BUILT_AT})`));

  /* description */
  const descFile = join(root, cfg.project.description_file);
  if (!existsSync(descFile)) fail(`No description at ${cfg.project.description_file}`);
  else {
    const text = readFileSync(descFile, "utf8").replace(/<!--[\s\S]*?-->/g, "").replace(/^#.*$/gm, "").trim();
    if (text.length < 80) {
      log.raw(warn(`${cfg.project.description_file} is nearly empty — phase 1 will have little to work with`));
    } else {
      log.raw(ok(`Project description present (${text.length} chars)`));
    }
  }

  /* git and disk */
  log.raw(isGitRepo(root) ? ok("Git repository detected — history will be scanned for secrets") : warn("Not a git repository — history secret-scanning is unavailable"));
  const free = diskFreeMb(root);
  if (free !== null && free < 200) fail(`Only ${free} MB free on this volume; the cache needs room`);
  else if (free !== null) log.raw(ok(`Disk space: ${free} MB free`));

  /* gitignore hygiene */
  const gi = existsSync(join(root, ".gitignore")) ? readFileSync(join(root, ".gitignore"), "utf8") : "";
  if (!gi.includes(BRAND.stateDir)) {
    fail(`${BRAND.stateDir}/ is not gitignored — the pseudonym map must never be committed`);
  } else {
    log.raw(ok(`${BRAND.stateDir}/ is gitignored (the pseudonym map stays local)`));
  }

  /* budgets */
  const caps = cfg.budget.per_run_usd;
  const totalCap = caps.research + caps.security + caps.architect;
  log.raw(ok(`Budget: $${totalCap.toFixed(2)} per run (research $${caps.research}, security $${caps.security}, architect $${caps.architect}), on exceed: ${cfg.budget.on_exceed}`));

  /* key */
  const key = getKey("openrouter");
  if (!key) {
    fail(`No OpenRouter key. Set $${ENV_VAR.openrouter} or run \`${BRAND.name} keys set\`.`);
  } else {
    log.raw(ok(`OpenRouter key found (${keyLocations()[0]!.source})`));
  }

  if (localOnly) {
    log.blank();
    log.raw(info("--local: skipped model-id validation and all network checks."));
    return summarise(failures);
  }

  if (!key) return summarise(failures);

  /* model ids validated against the live list — §2 */
  const providers = createProviders(cfg, p, "doctor");
  try {
    const models = await providers.architect.listModelsDetailed();
    const ids = new Set(models.map((m) => m.id));
    log.raw(ok(`OpenRouter reachable: ${models.length} model(s) available on this account`));

    for (const [seat, spec] of Object.entries(cfg.models)) {
      if (ids.has(spec.id)) {
        log.raw(ok(`  ${seat.padEnd(10)} ${spec.id}`));
      } else {
        fail(`  ${seat.padEnd(10)} ${spec.id} — not available on this account`);
        const suggestions = [...ids]
          .filter((id) => id.split("/")[0] === spec.id.split("/")[0])
          .slice(0, 6);
        if (suggestions.length) {
          log.raw(info(`    available from ${spec.id.split("/")[0]}: ${suggestions.join(", ")}`));
        }
      }
    }

    // Refresh the local price table so dry-run projections stay honest.
    const pricing: Record<string, { input_per_mtok: number; output_per_mtok: number }> = {};
    for (const m of models) {
      const inp = Number(m.pricing?.prompt);
      const outp = Number(m.pricing?.completion);
      if (Number.isFinite(inp) && Number.isFinite(outp)) {
        pricing[m.id] = { input_per_mtok: inp * 1_000_000, output_per_mtok: outp * 1_000_000 };
      }
    }
    if (Object.keys(pricing).length) {
      writeJson(join(p.state, "pricing.json"), pricing);
      log.raw(ok(`Refreshed local price table for ${Object.keys(pricing).length} model(s)`));
    }

    /* seats on distinct families — §2 */
    const families = new Set(Object.values(cfg.models).map((m) => m.id.split("/")[0]));
    if (families.size < 3) {
      log.raw(
        warn(
          `Only ${families.size} distinct model famil${families.size === 1 ? "y" : "ies"} across three seats. ` +
            `The seats are meant to be different families so nothing marks its own homework.`,
        ),
      );
    } else {
      log.raw(ok(`Three seats on three distinct model families`));
    }

    const info_ = await providers.architect.keyInfo();
    if (info_) {
      const used = info_.usage ?? 0;
      const limit = info_.limit;
      log.raw(ok(`Credit: $${used.toFixed(2)} used${limit != null ? ` of $${limit.toFixed(2)}` : " (no hard limit set)"}`));
      if (limit != null && limit - used < totalCap) {
        log.raw(warn(`Remaining credit ($${(limit - used).toFixed(2)}) is below the per-run budget ($${totalCap.toFixed(2)}).`));
      }
    }
  } catch (e) {
    fail(`OpenRouter check failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  /* §5.5 privacy posture */
  if (privacy) {
    heading("Vendor-side data handling");
    const posture = providers.architect.privacyPosture();
    kv("Control", posture.control);
    kv("Applied by this tool", posture.applied ? "yes" : "no");
    log.blank();
    log.raw(`  ${posture.note.replace(/\n/g, "\n  ")}`);
    log.blank();
    log.raw(color.gray(`  Pinned hosts (everything else is blocked): ${PINNED_HOSTS.join(", ")}`));
    log.raw(color.gray(`  Model endpoint: ${OPENROUTER.chat}`));
  }

  return summarise(failures);
}

function summarise(failures: number): number {
  log.blank();
  if (failures === 0) {
    log.raw(ok("All checks passed."));
    return 0;
  }
  log.raw(bad(`${failures} check(s) failed.`));
  return 1;
}

function diskFreeMb(dir: string): number | null {
  try {
    const r = Bun.spawnSync({ cmd: ["df", "-Pm", dir], stdout: "pipe", stderr: "pipe" });
    if (r.exitCode !== 0) return null;
    const line = String(r.stdout).split("\n")[1] ?? "";
    const cols = line.split(/\s+/);
    const avail = Number(cols[3]);
    return Number.isFinite(avail) ? avail : null;
  } catch {
    return null;
  }
}

/* ───────────────────────────── verify ───────────────────────────── */

export async function cmdVerify(): Promise<number> {
  heading(`${BRAND.display} verify`);
  const exe = process.execPath;
  const self = Bun.main;

  log.raw(`  Version:        ${BRAND.version}`);
  log.raw(`  Embedded data:  v${EMBED_VERSION} (${EMBED_BUILT_AT})`);
  log.raw(`  Running from:   ${self}`);
  log.blank();

  const target = existsSync(exe) && !exe.includes("bun") ? exe : self;
  try {
    const digest = sha256(readBytes(target));
    log.raw(`  SHA-256 of ${target}:`);
    log.raw(`    ${color.bold(digest)}`);
    log.blank();
    log.raw(`  Compare this against the .sha256 file shipped alongside the binary you were handed:`);
    log.raw(color.gray(`    shasum -a 256 ${target}`));
    log.raw(color.gray(`    cat ${target}.sha256`));
  } catch (e) {
    log.raw(warn(`Could not hash the running binary: ${e instanceof Error ? e.message : String(e)}`));
  }

  log.blank();
  const sigFile = `${target}.minisig`;
  if (existsSync(sigFile)) {
    log.raw(ok(`Signature file present: ${sigFile}`));
    log.raw(info(`Verify it with: minisign -Vm ${target} -P <public key>`));
  } else {
    log.raw(info(`No .minisig alongside the binary. If you were handed one, put it next to the executable.`));
  }
  log.blank();
  log.raw(color.gray(`  ${BRAND.disclaimerShort}`));
  return 0;
}

/* ───────────────────────────── keys ───────────────────────────── */

export async function cmdKeys(args: ParsedArgs): Promise<number> {
  const sub = args.sub[0] ?? "where";

  switch (sub) {
    case "set": {
      const key = promptHidden(`  Paste your OpenRouter key: `);
      if (!key) throw new UserError("No key entered.");
      const source = setKey("openrouter", key);
      log.raw(ok(`Stored in ${source === "keychain" ? keychainName() : "an encrypted file"}.`));
      return 0;
    }
    case "rotate": {
      const key = promptHidden(`  Paste the new OpenRouter key: `);
      if (!key) throw new UserError("No key entered.");
      removeKey("openrouter");
      const source = setKey("openrouter", key);
      log.raw(ok(`Rotated. Stored in ${source === "keychain" ? keychainName() : "an encrypted file"}.`));
      log.raw(info("Revoke the old key at https://openrouter.ai/keys — this tool cannot do that for you."));
      return 0;
    }
    case "remove": {
      const removed = removeKey("openrouter");
      log.raw(removed ? ok("Key removed from local storage.") : warn("No stored key found."));
      log.raw(info("If it was set via an environment variable, unset that too."));
      return 0;
    }
    case "where":
    default: {
      heading("Where your key lives");
      for (const loc of keyLocations()) {
        const status = loc.source === "absent" ? bad("not set") : ok(loc.source);
        log.raw(`  ${loc.provider.padEnd(12)} ${status}  ${color.gray(loc.detail)}`);
      }
      log.blank();
      log.raw(color.gray(`  Keys are never written to argv, never logged, and are redacted from every stack trace.`));
      log.raw(color.gray(`  Storage preference: OS keychain → encrypted file (scrypt + AES-256-GCM, mode 0600).`));
      return 0;
    }
  }
}

/* ───────────────────────────── regions ───────────────────────────── */

export async function cmdRegions(args: ParsedArgs): Promise<number> {
  const sub = args.sub[0] ?? "list";
  const p = makePaths();

  if (sub === "describe") {
    const id = args.sub[1];
    if (!id) throw new UserError("Usage: addgp-lite regions describe <id>");
    const pack = getPack(id);
    heading(`${pack.name} (${pack.id})`);
    kv("Kind", pack.kind);
    kv("Depth", pack.depth);
    kv("Currency", pack.currency);
    kv("Regulator", `${pack.regulator.name} — ${pack.regulator.url}`);
    log.blank();
    log.raw(color.bold("  Instruments"));
    for (const i of pack.instruments) {
      log.raw(`    ${i.in_force ? ok("") : warn("")}${i.name}`);
      log.raw(color.gray(`      ${i.type}${i.sector ? `, ${i.sector}` : ""} — ${i.url}`));
    }
    log.blank();
    log.raw(color.bold("  Retrieval targets"));
    for (const s of pack.seed_obligations) {
      log.raw(`    ${s.title}`);
      log.raw(color.gray(`      facets: ${s.facets.join(", ")}`));
    }
    if (pack.notes) {
      log.blank();
      log.raw(color.gray(`  ${pack.notes}`));
    }
    log.blank();
    log.raw(
      color.gray(
        `  These are retrieval targets, not findings. Phase 2 must confirm each provision against a\n` +
          `  primary source before anything is reported.`,
      ),
    );
    return 0;
  }

  if (sub === "add" || sub === "remove") {
    const cfg = loadConfig(p.config);
    const id = args.sub[1];
    if (!id) throw new UserError(`Usage: addgp-lite regions ${sub} <id>`);
    const pack = getPack(id);
    const list = pack.kind === "region" ? cfg.regions : cfg.frameworks;
    if (sub === "add") {
      if (list.includes(id)) {
        log.raw(info(`${id} is already selected.`));
        return 0;
      }
      list.push(id);
      log.raw(ok(`Added ${pack.name}.`));
    } else {
      const idx = list.indexOf(id);
      if (idx === -1) {
        log.raw(info(`${id} was not selected.`));
        return 0;
      }
      list.splice(idx, 1);
      log.raw(ok(`Removed ${pack.name}.`));
    }
    saveConfig(p.config, cfg);
    return 0;
  }

  /* list */
  heading("Region packs shipped in this binary");
  let selected: string[] = [];
  try {
    const cfg = loadConfig(p.config);
    selected = [...cfg.regions, ...cfg.frameworks];
  } catch {
    /* no config yet */
  }
  table(
    ["", "id", "name", "kind", "depth", "instruments"],
    listPackIds().map((id) => {
      const pack = getPack(id);
      return [
        selected.includes(id) ? color.green("●") : color.gray("○"),
        pack.id,
        pack.name,
        pack.kind,
        pack.depth === "deep" ? color.green("deep") : "standard",
        String(pack.instruments.length),
      ];
    }),
  );
  log.blank();
  log.raw(color.gray("  ● selected in this project    ○ available"));
  log.raw(color.gray("  A regime with no shipped pack is not audited, and the report says so plainly."));
  return 0;
}

/* ───────────────────────────── cache ───────────────────────────── */

export async function cmdCache(args: ParsedArgs): Promise<number> {
  const p = makePaths();
  const cache = new Cache(p);
  const sub = args.sub[0] ?? "stats";

  switch (sub) {
    case "clear": {
      const n = cache.clear();
      log.raw(ok(`Cleared ${n} cache entr${n === 1 ? "y" : "ies"}.`));
      return 0;
    }
    case "export": {
      const out = args.sub[1] ?? "addgp-cache.tar.gz";
      if (!existsSync(p.cache)) throw new UserError("No cache to export.");
      const r = Bun.spawnSync({ cmd: ["tar", "-czf", out, "-C", p.state, "cache"], stdout: "pipe", stderr: "pipe" });
      if (r.exitCode !== 0) {
        throw new UserError(`Export failed: ${String(r.stderr)}`);
      }
      const size = statSync(out).size;
      log.raw(ok(`Exported ${bytes(size)} to ${out}`));
      log.blank();
      log.raw(
        color.gray(
          `  This bundle contains model OUTPUT keyed by input HASH. It carries no source code, no\n` +
            `  identifiers, and no pseudonym map — which is what makes it safe to put on a USB stick.\n` +
            `  One person with good bandwidth can supply a lab.`,
        ),
      );
      return 0;
    }
    case "import": {
      const file = args.sub[1];
      if (!file) throw new UserError("Usage: addgp-lite cache import <file.tar.gz>");
      if (!existsSync(file)) throw new UserError(`No such file: ${file}`);
      ensureDir(p.state);
      const r = Bun.spawnSync({ cmd: ["tar", "-xzf", file, "-C", p.state], stdout: "pipe", stderr: "pipe" });
      if (r.exitCode !== 0) {
        throw new UserError(`Import failed: ${String(r.stderr)}`);
      }
      const s = cache.stats();
      log.raw(ok(`Imported. Cache now holds ${s.entries} entr${s.entries === 1 ? "y" : "ies"} (${bytes(s.bytes)}).`));
      return 0;
    }
    default: {
      const s = cache.stats();
      heading("Cache");
      kv("Entries", String(s.entries));
      kv("Size", bytes(s.bytes));
      kv("Oldest entry", s.oldest_days === null ? "—" : `${s.oldest_days.toFixed(1)} days`);
      kv("Location", p.cache);
      log.blank();
      log.raw(color.gray("  Key = hash(prompt_version + sealed_input_hash + model_id + params)."));
      log.raw(color.gray("  Editing a prompt invalidates its entries; the cache stores no source code."));
      return 0;
    }
  }
}

/* ───────────────────────────── cost ───────────────────────────── */

export async function cmdCost(args: ParsedArgs): Promise<number> {
  const p = makePaths();
  const records = readJsonl<SpendRecord>(p.cost);
  if (!records.length) {
    log.raw(info("No spend recorded yet."));
    return 0;
  }

  const runFilter = flagString(args.flags, "run");
  const filtered = runFilter ? records.filter((r) => r.run_id === runFilter) : records;

  heading(runFilter ? `Spend for run ${runFilter}` : "Spend, all runs");

  const bySeat = new Map<string, { cost: number; calls: number; cached: number; in: number; out: number }>();
  const byPhase = new Map<number, number>();
  const byRun = new Map<string, number>();
  let reported = 0;

  for (const r of filtered) {
    const s = bySeat.get(r.seat) ?? { cost: 0, calls: 0, cached: 0, in: 0, out: 0 };
    s.cost += r.cost_usd;
    s.calls += r.cached ? 0 : 1;
    s.cached += r.cached ? 1 : 0;
    s.in += r.input_tokens;
    s.out += r.output_tokens;
    bySeat.set(r.seat, s);
    byPhase.set(r.phase, (byPhase.get(r.phase) ?? 0) + r.cost_usd);
    byRun.set(r.run_id, (byRun.get(r.run_id) ?? 0) + r.cost_usd);
    if (r.cost_reported) reported++;
  }

  table(
    ["seat", "calls", "cached", "in tok", "out tok", "cost"],
    [...bySeat].map(([seat, s]) => [
      seat,
      String(s.calls),
      String(s.cached),
      s.in.toLocaleString(),
      s.out.toLocaleString(),
      `$${s.cost.toFixed(4)}`,
    ]),
  );

  log.blank();
  table(
    ["phase", "cost"],
    [...byPhase].sort((a, b) => a[0] - b[0]).map(([phase, cost]) => [`phase ${phase}`, `$${cost.toFixed(4)}`]),
  );

  const total = filtered.reduce((n, r) => n + r.cost_usd, 0);
  log.blank();
  log.raw(`  ${color.bold("Total")}: $${total.toFixed(4)} across ${byRun.size} run(s)`);
  log.raw(
    color.gray(
      reported > 0
        ? `  ${reported} call(s) carry OpenRouter's own cost accounting — those figures are what you were charged.`
        : `  No vendor-reported costs in this range; figures are local estimates.`,
    ),
  );
  return 0;
}

/* ───────────────────────────── config helper ───────────────────────────── */

export function requireConfig(): { cfg: Config; p: ReturnType<typeof makePaths> } {
  const p = makePaths();
  const cfg = loadConfig(p.config);
  return { cfg, p };
}

export function readBaseline(p: ReturnType<typeof makePaths>): { gaps: string[]; created_at: string } | null {
  return readJson<{ gaps: string[]; created_at: string } | null>(p.baseline, null);
}

export { severityColor };
