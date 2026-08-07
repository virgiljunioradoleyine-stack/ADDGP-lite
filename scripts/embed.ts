#!/usr/bin/env bun
/**
 * Build step: turn packs/, prompts/ and data/ into a generated TypeScript module.
 *
 * This is what makes §1.1 true — "region packs, the PII lexicon, the vulnerability
 * database, and all prompts are embedded in the binary", so `init` and `doctor
 * --local` work with no network and no data directory beside the executable.
 *
 * It is also what keeps the §4 hard rule honest: prompts live as versioned .md
 * files that a reviewer can read and diff, and are only ever *derived* into TS.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";

const root = join(import.meta.dir, "..");
const outFile = join(root, "src", "generated", "embedded.ts");

function sha(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function readDir(dir: string, ext: string): { name: string; content: string }[] {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((f) => f.endsWith(ext))
    .sort()
    .map((f) => ({ name: f.slice(0, -ext.length), content: readFileSync(join(abs, f), "utf8") }));
}

/** Split a prompt file into front matter, SYSTEM and USER sections. */
function parsePrompt(content: string) {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  const meta: Record<string, string> = {};
  if (fmMatch) {
    for (const line of fmMatch[1]!.split("\n")) {
      const idx = line.indexOf(":");
      if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  const body = fmMatch ? content.slice(fmMatch[0].length) : content;
  const sysIdx = body.indexOf("# SYSTEM");
  const userIdx = body.indexOf("# USER");
  const system = sysIdx >= 0 ? body.slice(sysIdx + "# SYSTEM".length, userIdx >= 0 ? userIdx : undefined).trim() : "";
  const user = userIdx >= 0 ? body.slice(userIdx + "# USER".length).trim() : body.trim();
  return {
    id: meta.id ?? "unknown",
    version: meta.version ?? "0.0.0",
    seat: meta.seat ?? "architect",
    phase: Number(meta.phase ?? 0),
    system,
    user,
    hash: sha(content).slice(0, 16),
  };
}

const packs = readDir("packs", ".json").map((p) => {
  try {
    return { name: p.name, data: JSON.parse(p.content) as unknown };
  } catch (e) {
    throw new Error(`packs/${p.name}.json is not valid JSON: ${(e as Error).message}`);
  }
});

const prompts = readDir("prompts", ".md").map((p) => ({ name: p.name, ...parsePrompt(p.content) }));

const dataFiles: Record<string, unknown> = {};
for (const f of readDir("data", ".json")) {
  dataFiles[f.name] = JSON.parse(f.content);
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };

const banner = `// GENERATED FILE — do not edit.
// Produced by scripts/embed.ts from packs/, prompts/ and data/.
// Run \`bun run embed\` after changing any of those.
`;

const body = `${banner}
export const EMBED_VERSION = ${JSON.stringify(pkg.version)};
export const EMBED_BUILT_AT = ${JSON.stringify(new Date().toISOString().slice(0, 10))};

export interface EmbeddedPrompt {
  id: string;
  version: string;
  seat: string;
  phase: number;
  system: string;
  user: string;
  hash: string;
}

export const PACKS: Record<string, unknown> = ${JSON.stringify(Object.fromEntries(packs.map((p) => [p.name, p.data])), null, 2)};

export const PROMPTS: Record<string, EmbeddedPrompt> = ${JSON.stringify(
  Object.fromEntries(
    prompts.map((p) => [
      p.name,
      { id: p.id, version: p.version, seat: p.seat, phase: p.phase, system: p.system, user: p.user, hash: p.hash },
    ]),
  ),
  null,
  2,
)};

export const DATA: Record<string, unknown> = ${JSON.stringify(dataFiles, null, 2)};
`;

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, body);

const bytes = Buffer.byteLength(body, "utf8");
console.log(
  `embedded ${packs.length} packs, ${prompts.length} prompts, ${Object.keys(dataFiles).length} data files ` +
    `→ src/generated/embedded.ts (${(bytes / 1024).toFixed(0)} KB)`,
);
