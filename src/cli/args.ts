export interface ParsedArgs {
  command: string;
  sub: string[];
  flags: Record<string, string | boolean>;
}

/**
 * Minimal argument parser. No dependency, because a compliance tool that pulls
 * in a transitive tree to parse `--help` has a hard time arguing about supply
 * chain hygiene in its own report.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq > 0) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const name = arg.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith("-")) {
          flags[name] = next;
          i++;
        } else {
          flags[name] = true;
        }
      }
      continue;
    }
    if (arg.startsWith("-") && arg.length > 1) {
      for (const ch of arg.slice(1)) flags[ch] = true;
      continue;
    }
    positional.push(arg);
  }

  return {
    command: positional[0] ?? "",
    sub: positional.slice(1),
    flags,
  };
}

export function flagString(flags: ParsedArgs["flags"], name: string): string | undefined {
  const v = flags[name];
  return typeof v === "string" ? v : undefined;
}

export function flagBool(flags: ParsedArgs["flags"], name: string): boolean {
  return flags[name] === true || flags[name] === "true";
}

export function flagList(flags: ParsedArgs["flags"], name: string): string[] | undefined {
  const v = flagString(flags, name);
  if (v === undefined) return undefined;
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

export function flagNumber(flags: ParsedArgs["flags"], name: string): number | undefined {
  const v = flagString(flags, name);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
