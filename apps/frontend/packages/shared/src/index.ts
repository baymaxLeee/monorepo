import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export const API_BASE_URL =
  (typeof window !== "undefined" && (window as { __API_BASE__?: string }).__API_BASE__) ||
  "http://localhost:8000";
