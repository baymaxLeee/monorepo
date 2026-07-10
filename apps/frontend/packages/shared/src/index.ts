import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Safe error-message extractor for UI display / inline error state.
 *
 * Kept as a pure module-level helper on purpose: an inline
 * `err instanceof Error ? err.message : ...` inside an async `try/catch` is
 * miscompiled by React Compiler v1 (the `catch` binding is dropped), so the
 * ternary must live outside component bodies.
 */
export function getErrorMessage(error: unknown, fallback = "操作失败"): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

declare const process: { env: { API_BASE_URL?: string } } | undefined;

export const API_BASE_URL =
  (typeof window !== "undefined" &&
    (window as { __API_BASE__?: string }).__API_BASE__) ||
  (typeof process !== "undefined" ? process.env.API_BASE_URL : undefined) ||
  "";

/**
 * Collision-resistant random id (v4 UUID shape).
 *
 * `crypto.randomUUID` is only exposed in a secure context (HTTPS or localhost);
 * on a plain-HTTP origin — e.g. the IP-based single-VPS demo at
 * `http://<ip>:8080` — it is `undefined` and calling it throws. `getRandomValues`
 * has no such restriction, so we build the UUID by hand when needed.
 */
export function randomId(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const hex = Array.from(c.getRandomValues(new Uint8Array(16)), (byte, i) => {
      let value = byte;
      if (i === 6) value = (value & 0x0f) | 0x40;
      if (i === 8) value = (value & 0x3f) | 0x80;
      return value.toString(16).padStart(2, "0");
    });
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

/** Allow only http(s) links for user/model-provided hrefs — blocks javascript:, data:, etc. */
export function isPublicHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
