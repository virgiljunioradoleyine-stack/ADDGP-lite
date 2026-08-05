import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { BRAND } from "../brand.ts";
import { exec } from "../util/exec.ts";
import { keyStorePath, writeFileSecure } from "../util/paths.ts";
import { redactValue, log, UserError } from "../util/log.ts";

export type Provider = "perplexity" | "openai" | "anthropic";
export const PROVIDERS: Provider[] = ["perplexity", "openai", "anthropic"];

export const ENV_VAR: Record<Provider, string> = {
  perplexity: "PERPLEXITY_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

export type KeySource = "env" | "keychain" | "encrypted-file" | "absent";

export interface KeyLocation {
  provider: Provider;
  source: KeySource;
  detail: string;
}

/* ─────────────────────────── OS keychain adapters ─────────────────────────── */

interface KeychainAdapter {
  readonly name: string;
  available(): boolean;
  get(account: string): string | null;
  set(account: string, secret: string): boolean;
  remove(account: string): boolean;
}

const service = BRAND.name;

/** macOS Keychain via /usr/bin/security. Secret passed via -w, never echoed. */
const macAdapter: KeychainAdapter = {
  name: "macOS Keychain",
  available: () => process.platform === "darwin" && existsSync("/usr/bin/security"),
  get(account) {
    const r = exec("/usr/bin/security", [
      "find-generic-password", "-s", service, "-a", account, "-w",
    ]);
    return r.ok ? r.stdout.trim() || null : null;
  },
  set(account, secret) {
    return exec("/usr/bin/security", [
      "add-generic-password", "-U", "-s", service, "-a", account, "-w", secret,
    ]).ok;
  },
  remove(account) {
    return exec("/usr/bin/security", [
      "delete-generic-password", "-s", service, "-a", account,
    ]).ok;
  },
};

/** Linux: libsecret via secret-tool, when a session keyring is actually present. */
const linuxAdapter: KeychainAdapter = {
  name: "libsecret (secret-tool)",
  available() {
    if (process.platform !== "linux") return false;
    if (!exec("which", ["secret-tool"]).ok) return false;
    // A keyring with no D-Bus session is a keyring that will hang. Skip it.
    return !!process.env.DBUS_SESSION_BUS_ADDRESS;
  },
  get(account) {
    const r = exec("secret-tool", ["lookup", "service", service, "account", account], undefined, 5000);
    return r.ok ? r.stdout.trim() || null : null;
  },
  set(account, secret) {
    // secret goes in on stdin, never in argv
    const proc = Bun.spawnSync({
      cmd: ["secret-tool", "store", "--label", `${service}:${account}`, "service", service, "account", account],
      stdin: Buffer.from(secret),
      stdout: "pipe",
      stderr: "pipe",
    });
    return proc.exitCode === 0;
  },
  remove(account) {
    return exec("secret-tool", ["clear", "service", service, "account", account], undefined, 5000).ok;
  },
};

/** Windows Credential Manager via PowerShell CredentialManager-free API. */
const winAdapter: KeychainAdapter = {
  name: "Windows Credential Manager",
  available: () => process.platform === "win32",
  get(account) {
    const r = exec("cmdkey", ["/list:" + `${service}:${account}`]);
    // cmdkey cannot read back the secret; treat as unavailable for reads.
    return r.ok && r.stdout.includes(account) ? null : null;
  },
  set() {
    return false;
  },
  remove(account) {
    return exec("cmdkey", ["/delete:" + `${service}:${account}`]).ok;
  },
};

function adapter(): KeychainAdapter | null {
  for (const a of [macAdapter, linuxAdapter, winAdapter]) if (a.available()) return a;
  return null;
}

/* ─────────────────────────── encrypted-file fallback ─────────────────────────── */

/**
 * Fallback keystore: scrypt-derived key + AES-256-GCM, file mode 0600, outside
 * the repo. Uses the `age` binary when present so users who already manage age
 * identities can keep doing so; otherwise the built-in cipher above.
 *
 * The passphrase comes from ADDGP_KEYSTORE_PASSPHRASE or an interactive prompt.
 * It is never written anywhere.
 */
interface Vault {
  v: 1;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

function deriveKey(pass: string, salt: Buffer): Buffer {
  return scryptSync(pass, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 });
}

function encryptVault(secrets: Record<string, string>, pass: string): Vault {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(pass, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(secrets), "utf8"),
    cipher.final(),
  ]);
  return {
    v: 1,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}

function decryptVault(vault: Vault, pass: string): Record<string, string> {
  const key = deriveKey(pass, Buffer.from(vault.salt, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(vault.iv, "base64"));
  decipher.setAuthTag(Buffer.from(vault.tag, "base64"));
  const out = Buffer.concat([
    decipher.update(Buffer.from(vault.data, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(out.toString("utf8")) as Record<string, string>;
}

function passphrase(promptText: string): string {
  const env = process.env.ADDGP_KEYSTORE_PASSPHRASE;
  if (env) return env;
  const entered = promptHidden(promptText);
  if (!entered) {
    throw new UserError(
      "A passphrase is required to unlock the encrypted keystore.",
      "Set ADDGP_KEYSTORE_PASSPHRASE for non-interactive use.",
    );
  }
  return entered;
}

/** Read from the terminal without echo. Never appears in argv or history. */
export function promptHidden(text: string): string {
  process.stdout.write(text);
  const fs = require("node:fs") as typeof import("node:fs");

  let fd = 0;
  let opened = false;
  try {
    if (existsSync("/dev/tty")) {
      fd = fs.openSync("/dev/tty", "rs");
      opened = true;
    }
  } catch {
    fd = 0;
  }

  let raw = false;
  try {
    if (process.stdin.isTTY && !opened) {
      process.stdin.setRawMode?.(true);
      raw = true;
    } else if (opened) {
      // Raw mode on the tty device, via stty, so the passphrase is not echoed.
      raw = exec("stty", ["-F", "/dev/tty", "-echo", "raw"]).ok;
    }
  } catch {
    raw = false;
  }

  const ETX = 0x03;
  const BS = 0x08;
  const LF = 0x0a;
  const CR = 0x0d;
  const DEL = 0x7f;

  const buf = Buffer.alloc(1);
  let out = "";
  try {
    for (;;) {
      let n = 0;
      try {
        n = fs.readSync(fd, buf, 0, 1, null);
      } catch {
        break;
      }
      if (n === 0) break;
      const b = buf[0]!;
      if (b === LF || b === CR) break;
      if (b === ETX) {
        restoreTty(raw, opened);
        process.stdout.write("\n");
        process.exit(130);
      }
      if (b === BS || b === DEL) {
        out = out.slice(0, -1);
        continue;
      }
      out += String.fromCharCode(b);
    }
  } finally {
    restoreTty(raw, opened);
    if (opened) {
      try {
        fs.closeSync(fd);
      } catch {
        /* already closed */
      }
    }
  }
  process.stdout.write("\n");
  return out.trim();
}

function restoreTty(raw: boolean, opened: boolean): void {
  if (!raw) return;
  try {
    if (opened) exec("stty", ["-F", "/dev/tty", "echo", "cooked"]);
    else process.stdin.setRawMode?.(false);
  } catch {
    /* best effort */
  }
}

/** Visible line input, for non-secret answers. */
export function promptLine(text: string, fallback = ""): string {
  process.stdout.write(text);
  const fs = require("node:fs") as typeof import("node:fs");
  const buf = Buffer.alloc(1);
  let out = "";
  for (;;) {
    let n = 0;
    try {
      n = fs.readSync(0, buf, 0, 1, null);
    } catch {
      break;
    }
    if (n === 0) break;
    const ch = buf.toString("utf8");
    if (ch === "\n") break;
    if (ch === "\r") continue;
    out += ch;
  }
  const trimmed = out.trim();
  return trimmed || fallback;
}

function readVaultFile(): Vault | null {
  const f = keyStorePath();
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf8")) as Vault;
  } catch {
    return null;
  }
}

/* ─────────────────────────── public API ─────────────────────────── */

const memo = new Map<Provider, string | null>();

export function getKey(provider: Provider): string | null {
  if (memo.has(provider)) return memo.get(provider)!;
  const key = resolveKey(provider);
  if (key) redactValue(key);
  memo.set(provider, key);
  return key;
}

function resolveKey(provider: Provider): string | null {
  const env = process.env[ENV_VAR[provider]];
  if (env?.trim()) return env.trim();

  const a = adapter();
  if (a) {
    const v = a.get(provider);
    if (v) return v;
  }

  const vault = readVaultFile();
  if (vault) {
    try {
      const secrets = decryptVault(vault, passphrase(`Passphrase for ${BRAND.name} keystore: `));
      const v = secrets[provider];
      if (v) return v;
    } catch (e) {
      if (e instanceof UserError) throw e;
      throw new UserError("Could not decrypt the keystore — wrong passphrase?");
    }
  }
  return null;
}

export function setKey(provider: Provider, secret: string): KeySource {
  memo.delete(provider);
  redactValue(secret);
  const a = adapter();
  if (a && a.set(provider, secret)) return "keychain";

  const existing = readVaultFile();
  const pass = passphrase(
    existing ? `Passphrase for ${BRAND.name} keystore: ` : `Choose a passphrase for the ${BRAND.name} keystore: `,
  );
  let secrets: Record<string, string> = {};
  if (existing) {
    try {
      secrets = decryptVault(existing, pass);
    } catch {
      throw new UserError("Could not decrypt the existing keystore — wrong passphrase?");
    }
  }
  secrets[provider] = secret;
  writeFileSecure(keyStorePath(), JSON.stringify(encryptVault(secrets, pass), null, 2));
  return "encrypted-file";
}

export function removeKey(provider: Provider): boolean {
  memo.delete(provider);
  let removed = false;
  const a = adapter();
  if (a?.remove(provider)) removed = true;
  const existing = readVaultFile();
  if (existing) {
    try {
      const pass = passphrase(`Passphrase for ${BRAND.name} keystore: `);
      const secrets = decryptVault(existing, pass);
      if (secrets[provider]) {
        delete secrets[provider];
        removed = true;
        if (Object.keys(secrets).length === 0) unlinkSync(keyStorePath());
        else writeFileSecure(keyStorePath(), JSON.stringify(encryptVault(secrets, pass), null, 2));
      }
    } catch {
      log.warn("Keystore present but could not be opened; left untouched.");
    }
  }
  return removed;
}

/** Where each key lives — never what it is. Powers `keys where`. */
export function keyLocations(): KeyLocation[] {
  const a = adapter();
  const vault = readVaultFile();
  return PROVIDERS.map((provider) => {
    if (process.env[ENV_VAR[provider]]?.trim()) {
      return { provider, source: "env" as const, detail: `$${ENV_VAR[provider]}` };
    }
    if (a) {
      const found = a.get(provider);
      if (found) return { provider, source: "keychain" as const, detail: a.name };
    }
    if (vault) {
      return { provider, source: "encrypted-file" as const, detail: keyStorePath() };
    }
    return { provider, source: "absent" as const, detail: "not set" };
  });
}

export function keychainName(): string {
  return adapter()?.name ?? `encrypted file (${keyStorePath()})`;
}
