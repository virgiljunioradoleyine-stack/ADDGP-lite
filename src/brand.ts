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

/** The only three hosts this tool may ever contact. Enforced by the egress gate. */
export const PINNED_HOSTS = [
  "api.perplexity.ai",
  "api.openai.com",
  "api.anthropic.com",
] as const;

export type PinnedHost = (typeof PINNED_HOSTS)[number];
