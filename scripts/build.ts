#!/usr/bin/env bun
/**
 * Build a single self-contained executable for the host platform.
 *
 * §1.1: TypeScript source compiled with `bun build --compile`, no Node runtime
 * needed on the target machine, and region packs, the PII lexicon, the
 * vulnerability database and every prompt embedded in the binary.
 */
import { mkdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const outDir = join(root, "dist");
mkdirSync(outDir, { recursive: true });

const pkg = (await Bun.file(join(root, "package.json")).json()) as { version: string };
const target = process.argv[2] ?? "";
const name = target
  ? `addgp-lite-${pkg.version}-${target.replace("bun-", "")}`
  : `addgp-lite-${pkg.version}-${process.platform}-${process.arch}`;
const outfile = join(outDir, name + (target.includes("windows") ? ".exe" : ""));

if (!existsSync(join(root, "src", "generated", "embedded.ts"))) {
  console.error("src/generated/embedded.ts is missing. Run `bun run embed` first.");
  process.exit(1);
}

const args = [
  "build",
  join(root, "src", "cli", "main.ts"),
  "--compile",
  "--minify",
  "--sourcemap=none",
  `--outfile=${outfile}`,
];
if (target) args.push(`--target=${target}`);

console.log(`building ${name}${target ? ` for ${target}` : ""}…`);
const proc = Bun.spawnSync({ cmd: ["bun", ...args], cwd: root, stdout: "inherit", stderr: "inherit" });
if (proc.exitCode !== 0) process.exit(proc.exitCode ?? 1);

const size = statSync(outfile).size;
const digest = new Bun.CryptoHasher("sha256").update(await Bun.file(outfile).arrayBuffer()).digest("hex");
await Bun.write(`${outfile}.sha256`, `${digest}  ${name}\n`);

console.log(`  ${outfile}`);
console.log(`  ${(size / 1024 / 1024).toFixed(1)} MB`);
console.log(`  sha256 ${digest}`);
console.log("");
console.log("  Sign it before handing it over:");
console.log(`    minisign -Sm ${outfile}`);
