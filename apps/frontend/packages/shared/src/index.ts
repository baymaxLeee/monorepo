import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// Resolution order (mirrors api/http.ts):
// 1. window.__API_BASE__         — runtime override for standalone MFE preview
// 2. process.env.API_BASE_URL    — baked in at build time by host DefinePlugin
//                                  (for cross-origin SPA → backend)
// 3. ""                          — same-origin (rspack devServer.proxy in dev,
//                                  reverse proxy / same-origin in prod)
declare const process: { env: { API_BASE_URL?: string } } | undefined;

export const API_BASE_URL =
  (typeof window !== "undefined" &&
    (window as { __API_BASE__?: string }).__API_BASE__) ||
  (typeof process !== "undefined" ? process.env.API_BASE_URL : undefined) ||
  "";
