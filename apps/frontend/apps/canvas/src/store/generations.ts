import type { CanvasGenerationState } from "@repo/api";
import { atom } from "jotai";

export const generationStatusAtom = atom<ReadonlyMap<string, CanvasGenerationState>>(new Map());
export function nodeGenerationAtom(nodeId: string) {
  return atom((get) => get(generationStatusAtom).get(nodeId));
}
