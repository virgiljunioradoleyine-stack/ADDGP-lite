/**
 * Minimal glob matcher over POSIX-style relative paths.
 * Supports **, *, ?, {a,b} and character classes. No dependency, no surprises —
 * this sits on the sovereignty critical path, so it must be auditable.
 */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  let i = 0;
  const braces: number[] = [];
  while (i < glob.length) {
    const ch = glob[i]!;
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        // ** — spans separators
        const nextIsSlash = glob[i + 2] === "/";
        re += nextIsSlash ? "(?:.*/)?" : ".*";
        i += nextIsSlash ? 3 : 2;
        continue;
      }
      re += "[^/]*";
      i++;
      continue;
    }
    if (ch === "?") {
      re += "[^/]";
      i++;
      continue;
    }
    if (ch === "{") {
      braces.push(1);
      re += "(?:";
      i++;
      continue;
    }
    if (ch === "}" && braces.length) {
      braces.pop();
      re += ")";
      i++;
      continue;
    }
    if (ch === "," && braces.length) {
      re += "|";
      i++;
      continue;
    }
    if (ch === "[") {
      const close = glob.indexOf("]", i);
      if (close > i) {
        let cls = glob.slice(i + 1, close);
        if (cls.startsWith("!")) cls = "^" + cls.slice(1);
        re += `[${cls}]`;
        i = close + 1;
        continue;
      }
    }
    re += ch.replace(/[.+^$()|\\]/g, "\\$&");
    i++;
  }
  return new RegExp(`^${re}$`);
}

const cache = new Map<string, RegExp>();

export function matchGlob(path: string, glob: string): boolean {
  let re = cache.get(glob);
  if (!re) {
    re = globToRegExp(glob);
    cache.set(glob, re);
  }
  const p = path.replace(/^\.\//, "");
  if (re.test(p)) return true;
  // A bare pattern like "*.pem" should also match nested files, matching
  // the intuition of everyone who writes a never_send list.
  if (!glob.includes("/")) {
    const base = p.split("/").pop()!;
    return re.test(base);
  }
  return false;
}

export function matchAny(path: string, globs: readonly string[]): boolean {
  return globs.some((g) => matchGlob(path, g));
}
