#!/usr/bin/env bun
/**
 * Cross-compile every shipped platform, checksum each artifact, and assemble the
 * hand-over tarball: binary + install.sh + README + SELF_COMPLIANCE.md.
 *
 * §1.1 platforms: darwin-arm64, darwin-x64, linux-x64, linux-arm64, windows-x64.
 */
import { mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const outDir = join(root, "release");
mkdirSync(outDir, { recursive: true });

const pkg = (await Bun.file(join(root, "package.json")).json()) as { version: string };

const TARGETS = [
  { bun: "bun-darwin-arm64", label: "darwin-arm64" },
  { bun: "bun-darwin-x64", label: "darwin-x64" },
  { bun: "bun-linux-x64", label: "linux-x64" },
  { bun: "bun-linux-arm64", label: "linux-arm64" },
  { bun: "bun-windows-x64", label: "windows-x64" },
];

// Packs, prompts and data must be embedded before anything is compiled.
const embed = Bun.spawnSync({ cmd: ["bun", "run", "scripts/embed.ts"], cwd: root, stdout: "inherit", stderr: "inherit" });
if (embed.exitCode !== 0) process.exit(1);

const built: { label: string; file: string; sha: string; bytes: number }[] = [];

for (const t of TARGETS) {
  const ext = t.label.startsWith("windows") ? ".exe" : "";
  const name = `addgp-lite-${pkg.version}-${t.label}${ext}`;
  const outfile = join(outDir, name);
  console.log(`\n▸ ${t.label}`);
  const proc = Bun.spawnSync({
    cmd: [
      "bun", "build", join(root, "src", "cli", "main.ts"),
      "--compile", "--minify", "--sourcemap=none",
      `--target=${t.bun}`, `--outfile=${outfile}`,
    ],
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (proc.exitCode !== 0) {
    console.error(`  failed: ${t.label}`);
    continue;
  }
  const bytes = statSync(outfile).size;
  const sha = new Bun.CryptoHasher("sha256").update(await Bun.file(outfile).arrayBuffer()).digest("hex");
  await Bun.write(`${outfile}.sha256`, `${sha}  ${name}\n`);
  built.push({ label: t.label, file: name, sha, bytes });
  console.log(`  ${(bytes / 1024 / 1024).toFixed(1)} MB · ${sha.slice(0, 16)}…`);
}

/* the hand-over tarball for the host platform */
const hostLabel = `${process.platform}-${process.arch}`;
const host = built.find((b) => b.label === hostLabel) ?? built[0];
if (host) {
  const stage = join(outDir, "tarball");
  mkdirSync(stage, { recursive: true });
  const copy = async (from: string, to: string) => {
    if (existsSync(from)) await Bun.write(join(stage, to), Bun.file(from));
  };
  await copy(join(outDir, host.file), "addgp-lite");
  await copy(join(outDir, `${host.file}.sha256`), "addgp-lite.sha256");
  await copy(join(root, "install.sh"), "install.sh");
  await copy(join(root, "README.md"), "README.md");
  await copy(join(root, "LICENSE"), "LICENSE");
  await copy(join(root, "SELF_COMPLIANCE.md"), "SELF_COMPLIANCE.md");

  Bun.spawnSync({ cmd: ["chmod", "+x", join(stage, "addgp-lite"), join(stage, "install.sh")] });
  const tar = join(outDir, `addgp-lite-${pkg.version}-${host.label}.tar.gz`);
  Bun.spawnSync({ cmd: ["tar", "-czf", tar, "-C", stage, "."], stdout: "inherit", stderr: "inherit" });
  console.log(`\n▸ tarball ${tar}`);
}

/* checksum manifest */
const manifest =
  `# addgp-lite ${pkg.version}\n` +
  `# Verify what you were handed:\n` +
  `#   shasum -a 256 -c SHA256SUMS\n\n` +
  built.map((b) => `${b.sha}  ${b.file}`).join("\n") +
  "\n";
await Bun.write(join(outDir, "SHA256SUMS"), manifest);

console.log(`\n${built.length}/${TARGETS.length} target(s) built → ${outDir}`);
console.log(`\nSign the release before handing it over:`);
console.log(`  minisign -Sm ${outDir}/addgp-lite-${pkg.version}-* `);
if (!existsSync(join(root, "SELF_COMPLIANCE.md"))) {
  console.log(
    `\n! SELF_COMPLIANCE.md is missing. Run \`addgp-lite selfcheck\` before releasing —\n` +
      `  a compliance tool that has not scanned itself has no standing.`,
  );
}
