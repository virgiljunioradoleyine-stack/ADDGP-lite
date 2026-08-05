import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { BRAND } from "../brand.ts";
import { UserError } from "../util/log.ts";
import { writeOut } from "../util/paths.ts";

export const SovereigntyLevel = z.union([z.literal(0), z.literal(1), z.literal(2)]);

export const ConfigSchema = z.object({
  version: z.literal(1),
  project: z.object({
    name: z.string().min(1),
    profile: z.enum(["student", "indie", "company"]).default("student"),
    description_file: z.string().default(".addgp/description.md"),
  }),
  regions: z.array(z.string()).min(1),
  sectors: z.array(z.string()).default([]),
  frameworks: z.array(z.string()).default([]),
  data_residency: z
    .object({
      users_in: z.array(z.string()).default([]),
      data_stored_in: z.array(z.string()).default([]),
    })
    .default({ users_in: [], data_stored_in: [] }),
  models: z.object({
    research: z.object({ provider: z.literal("perplexity"), id: z.string().min(1) }),
    security: z.object({ provider: z.literal("openai"), id: z.string().min(1) }),
    architect: z.object({ provider: z.literal("anthropic"), id: z.string().min(1) }),
  }),
  sovereignty: z
    .object({
      level: SovereigntyLevel.default(1),
      keep_comments: z.boolean().default(false),
      tokenise_terms: z.array(z.string()).default([]),
      never_send: z.array(z.string()).default([]),
      verbatim_allowlist: z.array(z.string()).default([]),
    })
    .default({
      level: 1,
      keep_comments: false,
      tokenise_terms: [],
      never_send: [],
      verbatim_allowlist: [],
    }),
  budget: z
    .object({
      per_run_usd: z
        .object({
          perplexity: z.number().nonnegative().default(5),
          openai: z.number().nonnegative().default(8),
          anthropic: z.number().nonnegative().default(8),
        })
        .default({ perplexity: 5, openai: 8, anthropic: 8 }),
      on_exceed: z.enum(["stop", "warn", "degrade"]).default("stop"),
    })
    .default({ per_run_usd: { perplexity: 5, openai: 8, anthropic: 8 }, on_exceed: "stop" }),
  scan: z
    .object({
      include: z.array(z.string()).default(["**/*"]),
      exclude: z
        .array(z.string())
        .default(["**/node_modules/**", "**/*.test.*", "**/fixtures/**"]),
      max_file_kb: z.number().positive().default(512),
    })
    .default({
      include: ["**/*"],
      exclude: ["**/node_modules/**", "**/*.test.*", "**/fixtures/**"],
      max_file_kb: 512,
    }),
  cache: z
    .object({
      ttl_days: z
        .object({
          corpus: z.number().positive().default(30),
          evidence: z.number().positive().default(7),
          adversary: z.number().positive().default(7),
        })
        .default({ corpus: 30, evidence: 7, adversary: 7 }),
    })
    .default({ ttl_days: { corpus: 30, evidence: 7, adversary: 7 } }),
  ci: z
    .object({
      fail_on: z.enum(["low", "medium", "high", "critical"]).default("critical"),
      baseline: z.string().default(".addgp/baseline.json"),
    })
    .default({ fail_on: "critical", baseline: ".addgp/baseline.json" }),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(file: string): Config {
  if (!existsSync(file)) {
    throw new UserError(
      `No ${BRAND.configFile} found at ${file}`,
      `Run \`${BRAND.name} init\` in your project root first.`,
    );
  }
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(file, "utf8"));
  } catch (e) {
    throw new UserError(`${BRAND.configFile} is not valid YAML: ${(e as Error).message}`);
  }
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new UserError(`${BRAND.configFile} is invalid:\n${issues}`);
  }
  return parsed.data;
}

export function saveConfig(file: string, cfg: Config): void {
  const header =
    `# ${BRAND.display} configuration\n` +
    `# ${BRAND.disclaimerShort}\n` +
    `# Model IDs are validated against your account by \`${BRAND.name} doctor\`.\n\n`;
  writeOut(file, header + stringifyYaml(cfg, { lineWidth: 100 }));
}

/** Defaults used by `init`. Model IDs are placeholders the user must confirm. */
export function defaultConfig(name: string, regions: string[]): Config {
  return ConfigSchema.parse({
    version: 1,
    project: { name, profile: "student", description_file: ".addgp/description.md" },
    regions,
    sectors: [],
    frameworks: ["owasp-llm-top10"],
    data_residency: { users_in: [], data_stored_in: [] },
    models: {
      research: { provider: "perplexity", id: "sonar-pro" },
      security: { provider: "openai", id: "gpt-4o" },
      architect: { provider: "anthropic", id: "claude-sonnet-4-5" },
    },
    sovereignty: {
      level: 1,
      keep_comments: false,
      tokenise_terms: [],
      never_send: [],
      verbatim_allowlist: [],
    },
    budget: { per_run_usd: { perplexity: 5, openai: 8, anthropic: 8 }, on_exceed: "stop" },
    scan: {
      include: ["**/*"],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/build/**",
        "**/*.min.js",
        "**/fixtures/**",
      ],
      max_file_kb: 512,
    },
    cache: { ttl_days: { corpus: 30, evidence: 7, adversary: 7 } },
    ci: { fail_on: "critical", baseline: ".addgp/baseline.json" },
  });
}
