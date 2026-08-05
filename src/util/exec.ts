import { spawnSync } from "node:child_process";

export interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Argument-array only. There is no shell string form anywhere in this codebase,
 * which is what §11 means by "no unsanitised shell-out".
 */
export function exec(cmd: string, args: string[], cwd?: string, timeoutMs = 20_000): ExecResult {
  try {
    const r = spawnSync(cmd, args, {
      cwd,
      timeout: timeoutMs,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      shell: false,
      windowsHide: true,
    });
    return {
      ok: r.status === 0,
      stdout: r.stdout ?? "",
      stderr: r.stderr ?? "",
      code: r.status ?? -1,
    };
  } catch (e) {
    return { ok: false, stdout: "", stderr: String(e), code: -1 };
  }
}

export function hasCommand(cmd: string): boolean {
  const probe = process.platform === "win32" ? "where" : "which";
  return exec(probe, [cmd]).ok;
}
