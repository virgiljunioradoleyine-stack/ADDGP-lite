/**
 * Logging. Two hard rules enforced here:
 *  - secrets registered via `redactValue` never reach stdout, stderr, or a stack trace
 *  - nothing here ever writes to the network
 */
const NO_COLOR = !!process.env.NO_COLOR || !process.stdout.isTTY;

const c = (code: string) => (s: string) => (NO_COLOR ? s : `\x1b[${code}m${s}\x1b[0m`);
export const color = {
  bold: c("1"),
  dim: c("2"),
  red: c("31"),
  green: c("32"),
  yellow: c("33"),
  blue: c("34"),
  magenta: c("35"),
  cyan: c("36"),
  gray: c("90"),
};

const redactions = new Set<string>();

/** Register a value (an API key) that must never appear in output. */
export function redactValue(v: string | undefined | null): void {
  if (v && v.length >= 8) redactions.add(v);
}

export function scrub(text: string): string {
  let out = text;
  for (const secret of redactions) {
    if (!secret) continue;
    out = out.split(secret).join(`<redacted:${secret.slice(0, 3)}…${secret.length}>`);
  }
  return out;
}

let quiet = false;
let verbose = false;
export function setQuiet(v: boolean) {
  quiet = v;
}
export function setVerbose(v: boolean) {
  verbose = v;
}
export function isVerbose() {
  return verbose;
}

const w = (stream: NodeJS.WriteStream, s: string) => stream.write(scrub(s) + "\n");

export const log = {
  raw: (s: string) => w(process.stdout, s),
  info: (s: string) => !quiet && w(process.stdout, s),
  step: (s: string) => !quiet && w(process.stdout, color.cyan("→ ") + s),
  ok: (s: string) => !quiet && w(process.stdout, color.green("✓ ") + s),
  warn: (s: string) => w(process.stderr, color.yellow("! ") + s),
  error: (s: string) => w(process.stderr, color.red("✗ ") + s),
  debug: (s: string) => verbose && w(process.stderr, color.gray("· " + s)),
  blank: () => !quiet && process.stdout.write("\n"),
};

/** Scrub secrets out of any error before it is ever shown. */
export function safeError(e: unknown): string {
  if (e instanceof Error) return scrub(e.message);
  return scrub(String(e));
}

export function safeStack(e: unknown): string {
  if (e instanceof Error && e.stack) return scrub(e.stack);
  return safeError(e);
}

/** A failure that should print cleanly and exit non-zero, not dump a stack. */
export class UserError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = "UserError";
  }
}
