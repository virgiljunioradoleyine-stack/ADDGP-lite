import { hashObject, sha256 } from "../util/hash.ts";
import type { Level, RedactedFile } from "./redactor.ts";

/**
 * §4 hard rule: no provider client may accept a raw payload.
 *
 * The brand is a unique symbol that only this module can attach, and the type is
 * not exported in a constructible form. `providers/base.ts` accepts SealedPayload
 * and nothing else, so `client.call("some raw string")` is a compile error rather
 * than a code-review question.
 */
declare const SEALED: unique symbol;

export interface SealedMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface SealedPayload {
  readonly [SEALED]: true;
  readonly messages: readonly SealedMessage[];
  /** what this payload represents, by REAL path — recorded locally, never sent */
  readonly represents: readonly string[];
  readonly level: Level;
  readonly payload_hash: string;
  readonly byte_count: number;
  readonly purpose: string;
  /** true when no repository content contributed to this payload at all */
  readonly code_free: boolean;
}

function seal(p: Omit<SealedPayload, typeof SEALED>): SealedPayload {
  return p as SealedPayload;
}

export interface SealInput {
  messages: SealedMessage[];
  represents?: string[];
  level: Level;
  purpose: string;
  code_free?: boolean;
}

/**
 * The only constructor of a SealedPayload. Everything that reaches a provider
 * goes through here, and everything here has already been through the redactor.
 */
export function sealPayload(input: SealInput): SealedPayload {
  const messages = input.messages.map((m) => ({ role: m.role, content: m.content }));
  const bytes = Buffer.byteLength(JSON.stringify(messages), "utf8");
  return seal({
    messages,
    represents: input.represents ?? [],
    level: input.level,
    payload_hash: hashObject(messages),
    byte_count: bytes,
    purpose: input.purpose,
    code_free: input.code_free ?? (input.represents ?? []).length === 0,
  });
}

/** Bundle redacted files into the body of a payload, with per-file headers. */
export function renderFileBundle(files: readonly RedactedFile[]): string {
  return files
    .map((f) => {
      const header = `--- file: ${f.sealed_path} (${f.lang}, sovereignty level ${f.level}) ---`;
      return `${header}\n${f.content.trimEnd()}\n`;
    })
    .join("\n");
}

export function payloadText(p: SealedPayload): string {
  return p.messages.map((m) => `[${m.role}]\n${m.content}`).join("\n\n");
}

export function payloadFingerprint(p: SealedPayload): string {
  return sha256(payloadText(p)).slice(0, 16);
}
