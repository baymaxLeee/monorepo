import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export {
  extractSlotIds,
  formatArtifactSlot,
  parseSlots,
  serializeSlots,
  tokenIdByArtifactId,
  resolveArtifactId,
  type ArtifactSlotSegment,
  type SerializeSlotsInput,
} from "./artifact-slots";

declare const process: { env: { API_BASE_URL?: string } } | undefined;

export const API_BASE_URL =
  (typeof window !== "undefined" &&
    (window as { __API_BASE__?: string }).__API_BASE__) ||
  (typeof process !== "undefined" ? process.env.API_BASE_URL : undefined) ||
  "";
