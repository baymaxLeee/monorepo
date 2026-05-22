import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// Default to "" (same-origin) so requests go through the host's dev/prod proxy
// (rspack devServer.proxy in dev, nginx/ingress in prod) — same-origin requests
// never trigger CORS preflight. Override via window.__API_BASE__ when a build
// must talk to a remote backend directly (e.g. standalone MFE preview).
export const API_BASE_URL =
  (typeof window !== "undefined" &&
    (window as { __API_BASE__?: string }).__API_BASE__) ||
  "";
