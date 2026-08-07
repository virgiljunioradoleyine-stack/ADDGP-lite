import { matchAny } from "../util/glob.ts";

/**
 * §5.3 — never sent, at any level. This runs *before* the redactor, not after.
 * A path on this list is not redacted-and-sent; it is not read for egress at all.
 */
export const NEVER_SEND_DEFAULT: readonly string[] = [
  // environment and secrets
  ".env", ".env.*", "**/.env", "**/.env.*", "*.env",
  "**/secrets/**", "**/credentials/**", "**/.aws/**", "**/.ssh/**", "**/.gnupg/**",
  "**/*.pem", "**/*.key", "**/*.p12", "**/*.pfx", "**/*.jks", "**/*.keystore",
  "**/*.crt", "**/*.cer", "**/*.der", "**/id_rsa*", "**/id_ed25519*",
  "**/.npmrc", "**/.pypirc", "**/.netrc", "**/.git-credentials",
  "**/serviceAccount*.json", "**/gcp-*.json", "**/*credentials*.json",

  // lockfiles — names and versions are extracted separately, contents never sent
  "**/package-lock.json", "**/yarn.lock", "**/pnpm-lock.yaml", "**/bun.lockb", "**/bun.lock",
  "**/poetry.lock", "**/Pipfile.lock", "**/Gemfile.lock", "**/composer.lock",
  "**/Cargo.lock", "**/go.sum", "**/gradle.lockfile",

  // data files — the tool reasons about schemas, never rows (§5.3)
  "**/*.csv", "**/*.tsv", "**/*.parquet", "**/*.avro", "**/*.orc", "**/*.feather",
  "**/*.xls", "**/*.xlsx", "**/*.ods", "**/*.dta", "**/*.sav",
  "**/*.sqlite", "**/*.sqlite3", "**/*.db", "**/*.mdb", "**/*.rdb", "**/dump.sql",
  "**/*.dump", "**/*.bak", "**/*.ndjson", "**/*.jsonl",
  "**/fixtures/**", "**/__fixtures__/**", "**/testdata/**", "**/test-data/**",
  "**/seeds/**", "**/seed/**", "**/*.seed.*", "**/factories/**",
  "**/sample_data/**", "**/sample-data/**",

  // notebooks carry outputs, which carry rows
  "**/*.ipynb",

  // binary and vendored
  "**/*.zip", "**/*.tar", "**/*.tar.gz", "**/*.tgz", "**/*.gz", "**/*.7z", "**/*.rar",
  "**/*.png", "**/*.jpg", "**/*.jpeg", "**/*.gif", "**/*.webp", "**/*.ico", "**/*.pdf",
  "**/*.mp4", "**/*.mov", "**/*.mp3", "**/*.wav", "**/*.woff", "**/*.woff2", "**/*.ttf",
  "**/*.so", "**/*.dylib", "**/*.dll", "**/*.exe", "**/*.wasm", "**/*.class", "**/*.jar",
  "**/node_modules/**", "**/vendor/**", "**/.git/**", "**/dist/**", "**/build/**",
  "**/.addgp/**", "**/coverage/**", "**/*.min.js", "**/*.min.css", "**/*.map",
  "addgp-lite.yaml", "**/addgp-lite.yaml",
];

export type DenyReason =
  | "env_file"
  | "private_key_or_cert"
  | "secrets_directory"
  | "lockfile_contents"
  | "data_file"
  | "notebook_output"
  | "binary_or_vendored"
  | "git_history"
  | "user_never_send"
  | "state_directory";

export interface DenyVerdict {
  denied: boolean;
  reason?: DenyReason;
  pattern?: string;
  explanation?: string;
}

const REASON_TABLE: { globs: string[]; reason: DenyReason; explanation: string }[] = [
  { globs: [".env", ".env.*", "**/.env", "**/.env.*", "*.env"], reason: "env_file",
    explanation: "environment files hold live credentials" },
  { globs: ["**/*.pem", "**/*.key", "**/*.p12", "**/*.pfx", "**/*.jks", "**/*.keystore", "**/*.crt", "**/*.cer", "**/*.der", "**/id_rsa*", "**/id_ed25519*"],
    reason: "private_key_or_cert", explanation: "private keys and certificates never leave the machine" },
  { globs: ["**/secrets/**", "**/credentials/**", "**/.aws/**", "**/.ssh/**", "**/.gnupg/**", "**/.npmrc", "**/.pypirc", "**/.netrc", "**/.git-credentials", "**/serviceAccount*.json", "**/gcp-*.json", "**/*credentials*.json"],
    reason: "secrets_directory", explanation: "credential stores never leave the machine" },
  { globs: ["**/package-lock.json", "**/yarn.lock", "**/pnpm-lock.yaml", "**/bun.lockb", "**/bun.lock", "**/poetry.lock", "**/Pipfile.lock", "**/Gemfile.lock", "**/composer.lock", "**/Cargo.lock", "**/go.sum", "**/gradle.lockfile"],
    reason: "lockfile_contents", explanation: "dependency names and versions are extracted locally; the lockfile itself is not sent" },
  { globs: ["**/*.ipynb"], reason: "notebook_output", explanation: "notebook outputs contain real rows" },
  { globs: ["**/*.csv", "**/*.tsv", "**/*.parquet", "**/*.avro", "**/*.orc", "**/*.feather", "**/*.xls", "**/*.xlsx", "**/*.ods", "**/*.dta", "**/*.sav", "**/*.sqlite", "**/*.sqlite3", "**/*.db", "**/*.mdb", "**/*.rdb", "**/dump.sql", "**/*.dump", "**/*.bak", "**/*.ndjson", "**/*.jsonl", "**/fixtures/**", "**/__fixtures__/**", "**/testdata/**", "**/test-data/**", "**/seeds/**", "**/seed/**", "**/*.seed.*", "**/factories/**", "**/sample_data/**", "**/sample-data/**"],
    reason: "data_file", explanation: "no customer or user data is ever sent, in any form, at any level" },
  { globs: ["**/.addgp/**", "addgp-lite.yaml", "**/addgp-lite.yaml"], reason: "state_directory", explanation: "this tool's own configuration and local state, including the pseudonym map" },
];

/**
 * @param path repo-relative POSIX path
 * @param userNeverSend `sovereignty.never_send` from the config
 */
export function denyCheck(path: string, userNeverSend: readonly string[] = []): DenyVerdict {
  if (userNeverSend.length && matchAny(path, userNeverSend)) {
    return {
      denied: true,
      reason: "user_never_send",
      pattern: userNeverSend.find((g) => matchAny(path, [g])),
      explanation: "listed in sovereignty.never_send",
    };
  }
  for (const entry of REASON_TABLE) {
    const hit = entry.globs.find((g) => matchAny(path, [g]));
    if (hit) {
      return { denied: true, reason: entry.reason, pattern: hit, explanation: entry.explanation };
    }
  }
  const other = NEVER_SEND_DEFAULT.find((g) => matchAny(path, [g]));
  if (other) {
    return {
      denied: true,
      reason: "binary_or_vendored",
      pattern: other,
      explanation: "binary, generated, or vendored content carries no reviewable logic",
    };
  }
  return { denied: false };
}

export function isDenied(path: string, userNeverSend: readonly string[] = []): boolean {
  return denyCheck(path, userNeverSend).denied;
}
