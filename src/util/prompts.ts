import { PROMPTS, type EmbeddedPrompt } from "../generated/embedded.ts";
import { UserError } from "./log.ts";

/**
 * §4 hard rule: no prompt string is ever written inline in TypeScript. Prompts
 * are versioned .md files under prompts/, embedded at build time, loaded here,
 * and their hash goes into the cache key so a prompt edit invalidates the cache.
 */
export function getPrompt(name: string): EmbeddedPrompt {
  const p = PROMPTS[name];
  if (!p) {
    throw new UserError(
      `Prompt "${name}" is not embedded in this build.`,
      `Available: ${Object.keys(PROMPTS).join(", ")}. Run \`bun run embed\` if you added one.`,
    );
  }
  return p;
}

export function promptVersion(name: string): string {
  const p = getPrompt(name);
  return `${p.id}@${p.version}+${p.hash}`;
}

/** Fill {{PLACEHOLDER}} slots. An unfilled slot is a bug, so it throws. */
export function fill(template: string, vars: Record<string, string>): string {
  const out = template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key: string) => {
    const v = vars[key];
    if (v === undefined) {
      throw new Error(`Prompt placeholder {{${key}}} was not provided`);
    }
    return v;
  });
  return out;
}

export function renderPrompt(
  name: string,
  vars: Record<string, string>,
): { system: string; user: string; version: string } {
  const p = getPrompt(name);
  return {
    system: p.system,
    user: fill(p.user, vars),
    version: promptVersion(name),
  };
}

export function allPromptHashes(): Record<string, string> {
  return Object.fromEntries(Object.entries(PROMPTS).map(([k, v]) => [k, `${v.version}+${v.hash}`]));
}
