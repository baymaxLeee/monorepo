import { atom } from "jotai";
export const studioViewAtom = atom<"canvas" | "storyboard">("canvas");
export const activeNodeIdAtom = atom<string | null>(null);
export const nodePanelOpenAtom = atom(true);
export const chatPanelOpenAtom = atom(true);
