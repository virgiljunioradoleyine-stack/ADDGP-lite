import { BRAND, STEWARD } from "../brand.ts";
import { color, log } from "../util/log.ts";

export function heading(text: string): void {
  log.blank();
  log.raw(color.bold(text));
  log.raw(color.gray("─".repeat(Math.min(text.length, 72))));
}

export function kv(key: string, value: string, width = 22): void {
  log.raw(`  ${color.gray(key.padEnd(width))}${value}`);
}

export function table(headers: string[], rows: string[][]): void {
  if (!rows.length) return;
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => stripAnsi(r[i] ?? "").length)),
  );
  log.raw("  " + color.bold(headers.map((h, i) => h.padEnd(widths[i]!)).join("  ")));
  log.raw("  " + color.gray(widths.map((w) => "─".repeat(w)).join("  ")));
  for (const row of rows) {
    log.raw(
      "  " +
        row
          .map((c, i) => {
            const pad = widths[i]! - stripAnsi(c).length;
            return c + " ".repeat(Math.max(0, pad));
          })
          .join("  "),
    );
  }
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;]*m/g, "");
}

export function severityColor(sev: string, text = sev): string {
  switch (sev) {
    case "critical":
      return color.red(color.bold(text));
    case "high":
      return color.red(text);
    case "medium":
      return color.yellow(text);
    case "low":
      return color.blue(text);
    default:
      return color.gray(text);
  }
}

export function ok(text: string): string {
  return color.green("✓ ") + text;
}

export function bad(text: string): string {
  return color.red("✗ ") + text;
}

export function warn(text: string): string {
  return color.yellow("! ") + text;
}

export function info(text: string): string {
  return color.gray("· ") + text;
}

/** The permanent footer of §0: on every report and every --help. */
export function disclaimerLine(): string {
  return color.gray(`  ${BRAND.disclaimerShort}\n  ${STEWARD.line}`);
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
