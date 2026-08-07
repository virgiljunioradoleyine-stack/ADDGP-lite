#!/usr/bin/env bun
import { BRAND, PINNED_HOSTS } from "../brand.ts";
import { parseArgs, flagBool } from "./args.ts";
import { log, color, setQuiet, setVerbose, UserError, safeError, safeStack } from "../util/log.ts";
import { EgressBlocked } from "../sovereignty/gate.ts";
import { BudgetExceeded } from "../providers/budget.ts";
import { heading, disclaimerLine } from "./ui.ts";
import {
  cmdInit, cmdDoctor, cmdVerify, cmdKeys, cmdRegions, cmdCache, cmdCost,
} from "./commands/setup.ts";
import {
  cmdScan, cmdSovereignty, cmdGaps, cmdPrompt, cmdFix, cmdLedger, cmdRoi,
  cmdReport, cmdDiff, cmdCi, cmdWatch, cmdExport, cmdShare, cmdSelfcheck, cmdStress,
} from "./commands/analyse.ts";

type Handler = (args: ReturnType<typeof parseArgs>) => Promise<number>;

const COMMANDS: Record<string, { run: Handler; summary: string; usage?: string }> = {
  init: { run: cmdInit, summary: "Key, project description, regions, sovereignty level, budget", usage: "init [--yes] [--regions gh,ng,eu] [--sovereignty 1] [--profile student]" },
  doctor: { run: cmdDoctor, summary: "Validate key, model ids, budgets, git repo, disk, pack freshness", usage: "doctor [--local] [--privacy]" },
  verify: { run: cmdVerify, summary: "Print this binary's own hash and signature status" },
  scan: { run: cmdScan, summary: "Full run", usage: "scan [--phases 0,1,2,3,4,5,6] [--resume <run-id>] [--since <git-ref>] [--offline] [--dry-run] [--sovereignty 0|1|2] [--format md,html,pdf,json,sarif] [--force]" },
  sovereignty: { run: cmdSovereignty, summary: "What would leave this machine, and what already has", usage: "sovereignty preview|map|ledger|level <0|1|2>" },
  regions: { run: cmdRegions, summary: "Region and framework packs", usage: "regions list|add <id>|remove <id>|describe <id>" },
  gaps: { run: cmdGaps, summary: "Browse gaps", usage: "gaps [<id>] [--severity high] [--regime eu] [--open] [--json]" },
  prompt: { run: cmdPrompt, summary: "The agent prompt for one gap", usage: "prompt <gap-id> | prompt --all" },
  fix: { run: cmdFix, summary: "The manual What/Why/How/Consequence for one gap", usage: "fix <gap-id>" },
  ledger: { run: cmdLedger, summary: "Legal exposure — quantified, qualitative, unknown", usage: "ledger [--json]" },
  roi: { run: cmdRoi, summary: "ROI report", usage: "roi [--assumptions <file>] [--json]" },
  report: { run: cmdReport, summary: "Re-render from cache without calling any model", usage: "report [--format md,html,pdf,json,sarif]" },
  diff: { run: cmdDiff, summary: "New gaps, closed gaps, changed law", usage: "diff <run-a> <run-b>" },
  ci: { run: cmdCi, summary: "Non-interactive; non-zero exit on new gaps above threshold", usage: "ci [--fail-on critical] [--update-baseline] [--offline]" },
  watch: { run: cmdWatch, summary: "Re-run phase 2 on a schedule; alert when cited law changes", usage: "watch [--interval 24] [--once]" },
  selfcheck: { run: cmdSelfcheck, summary: `Run ${BRAND.display} against ${BRAND.display}`, usage: "selfcheck [--source <path>]" },
  keys: { run: cmdKeys, summary: "Manage the OpenRouter key", usage: "keys set|rotate|remove|where" },
  cache: { run: cmdCache, summary: "Model-output cache", usage: "cache stats|clear|export [file]|import <file>" },
  cost: { run: cmdCost, summary: "Estimated and actual spend, per seat, per phase", usage: "cost [--run <run-id>]" },
  export: { run: cmdExport, summary: "Auditor bundle: report + evidence + citations + hashes", usage: "export [--out <file.zip>]" },
  share: { run: cmdShare, summary: "Generate a redacted traction receipt you choose to send", usage: "share [--badge]" },
  stress: { run: cmdStress, summary: "Generated load and resilience harnesses", usage: "stress list|run --target <url>" },
};

function usage(): void {
  log.raw("");
  log.raw(`  ${color.bold(BRAND.display)} v${BRAND.version} — ${BRAND.long}`);
  log.raw(`  ${color.gray(BRAND.tagline)}`);
  log.raw("");
  log.raw(`  ${color.bold("Usage")}  ${BRAND.name} <command> [options]`);
  log.raw("");

  const groups: [string, string[]][] = [
    ["Setup", ["init", "doctor", "keys", "regions", "verify"]],
    ["Audit", ["scan", "sovereignty", "gaps", "prompt", "fix"]],
    ["Reports", ["report", "ledger", "roi", "export", "share"]],
    ["Ongoing", ["ci", "diff", "watch", "selfcheck", "stress", "cache", "cost"]],
  ];

  for (const [group, names] of groups) {
    log.raw(`  ${color.bold(group)}`);
    for (const name of names) {
      const cmd = COMMANDS[name];
      if (!cmd) continue;
      log.raw(`    ${name.padEnd(14)}${color.gray(cmd.summary)}`);
    }
    log.raw("");
  }

  log.raw(`  ${color.bold("Global")}`);
  log.raw(`    --help          this text, or per-command usage`);
  log.raw(`    --version       print the version`);
  log.raw(`    --verbose       show debug output`);
  log.raw(`    --quiet         only warnings and errors`);
  log.raw(`    --no-color      disable colour (or set NO_COLOR)`);
  log.raw("");
  log.raw(`  ${color.bold("Cost")}`);
  log.raw(`    ${color.gray(`Bring your own OpenRouter key. You pay OpenRouter; ${BRAND.name} takes nothing,`)}`);
  log.raw(`    ${color.gray("gates nothing, and has no account, no tier, and no telemetry.")}`);
  log.raw("");
  log.raw(`  ${color.bold("Sovereignty")}`);
  log.raw(`    ${color.gray(`Your code never leaves in readable form. Run \`${BRAND.name} sovereignty preview\``)}`);
  log.raw(`    ${color.gray(`to see exactly what would be sent, per file, before anything is called.`)}`);
  log.raw(`    ${color.gray(`Only ${PINNED_HOSTS.join(", ")} is ever contacted; every other host is blocked.`)}`);
  log.raw("");
  log.raw(disclaimerLine());
  log.raw("");
}

function commandHelp(name: string): void {
  const cmd = COMMANDS[name];
  if (!cmd) return;
  heading(`${BRAND.name} ${name}`);
  log.raw(`  ${cmd.summary}`);
  log.raw("");
  log.raw(`  ${color.bold("Usage")}  ${BRAND.name} ${cmd.usage ?? name}`);
  log.raw("");
  log.raw(disclaimerLine());
  log.raw("");
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  if (flagBool(args.flags, "no-color")) process.env.NO_COLOR = "1";
  if (flagBool(args.flags, "verbose") || flagBool(args.flags, "v")) setVerbose(true);
  if (flagBool(args.flags, "quiet") || flagBool(args.flags, "q")) setQuiet(true);

  if (flagBool(args.flags, "version") || args.command === "version") {
    log.raw(`${BRAND.name} ${BRAND.version}`);
    return 0;
  }

  if (!args.command || args.command === "help") {
    if (args.sub[0] && COMMANDS[args.sub[0]]) {
      commandHelp(args.sub[0]);
      return 0;
    }
    usage();
    return args.command ? 0 : 1;
  }

  const cmd = COMMANDS[args.command];
  if (!cmd) {
    log.error(`Unknown command: ${args.command}`);
    const near = Object.keys(COMMANDS).filter((c) => c.startsWith(args.command[0] ?? ""));
    if (near.length) log.info(`Did you mean: ${near.join(", ")}?`);
    log.info(`Run \`${BRAND.name} --help\` for the full list.`);
    return 1;
  }

  if (flagBool(args.flags, "help") || flagBool(args.flags, "h")) {
    commandHelp(args.command);
    return 0;
  }

  return cmd.run(args);
}

/* ───────────────────────────── entry ───────────────────────────── */

if (import.meta.main) {
  let code = 0;
  try {
    code = await main(process.argv.slice(2));
  } catch (e) {
    log.blank();
    if (e instanceof EgressBlocked) {
      // The most important error in the tool: nothing was sent, and we say why.
      log.error(safeError(e));
      log.blank();
      log.warn("Nothing was transmitted. The egress gate aborts the run rather than cleaning and continuing.");
      if (e.hint) log.info(e.hint);
      code = 2;
    } else if (e instanceof BudgetExceeded) {
      log.error(safeError(e));
      if (e.hint) log.info(e.hint);
      code = 5;
    } else if (e instanceof UserError) {
      log.error(safeError(e));
      if (e.hint) log.info(e.hint);
      code = e.exitCode;
    } else {
      log.error(`Unexpected error: ${safeError(e)}`);
      log.debug(safeStack(e));
      log.info(`Re-run with --verbose for a stack trace. Keys are redacted from it.`);
      code = 1;
    }
    log.blank();
  }
  process.exit(code);
}
