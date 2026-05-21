export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

export const API_BASE_URL =
  (typeof window !== "undefined" && (window as { __API_BASE__?: string }).__API_BASE__) ||
  "http://localhost:8000";
