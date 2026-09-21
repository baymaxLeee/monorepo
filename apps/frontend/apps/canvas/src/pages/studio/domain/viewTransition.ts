import type { StudioView } from "./types";

export async function waitForCanvasEditingBeforeViewChange(
  current: StudioView,
  next: StudioView,
  finishCanvasEditing: (() => Promise<boolean>) | undefined,
) {
  if (current !== "canvas" || next !== "storyboard") return true;
  return (await finishCanvasEditing?.()) ?? true;
}
