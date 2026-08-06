/**
 * The only place the name appears. Everything else imports from here.
 */
export const BRAND = {
  name: "addgp-lite",
  display: "ADDGP-Lite",
  long: "African Data Governance Platform — Lite",
  version: "1.0.0",
  tagline: "Your code, your keys, your data, your report.",
  configFile: "addgp-lite.yaml",
  stateDir: ".addgp",
  outDir: "compliance",
  /** Permanent footer. On every report and every --help. Non-negotiable. */
  disclaimer:
    "ADDGP-Lite produces an engineering artifact, not legal advice. Every obligation it " +
    "reports must be reviewed by a qualified practitioner in the relevant jurisdiction " +
    "before it is relied upon.",
  disclaimerShort: "This is an engineering artifact, not legal advice.",
} as const;

/**
 * The only host this tool may ever contact. Enforced by the egress gate.
 *
 * All three model seats are reached through OpenRouter on a single key, so the
 * user signs up once and pays one vendor. That also narrows the egress surface
 * to exactly one hostname — anything else is a bug and is blocked.
 */
export const PINNED_HOSTS = ["openrouter.ai"] as const;

export type PinnedHost = (typeof PINNED_HOSTS)[number];

export const OPENROUTER = {
  base: "https://openrouter.ai/api/v1",
  chat: "https://openrouter.ai/api/v1/chat/completions",
  models: "https://openrouter.ai/api/v1/models",
  keyInfo: "https://openrouter.ai/api/v1/key",
  /** Attribution headers OpenRouter asks integrations to send. */
  referer: "https://github.com/addgp/addgp-lite",
  title: "ADDGP-Lite",
} as const;
