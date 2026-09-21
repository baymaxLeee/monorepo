import { canvasnode } from "@/domain";

export type CanvasNodeDoubleClickAction = "large-text-editor" | "large-text-preview" | "fullscreen" | "none";

export function canvasNodeDoubleClickAction(
  item: Pick<canvasnode.CanvasNode, "SelectedOutputText" | "Type">,
): CanvasNodeDoubleClickAction {
  if (item.Type === canvasnode.CanvasNodeType.TEXT) return "large-text-editor";
  if (item.Type === canvasnode.CanvasNodeType.TEXT_GENERATION) {
    return item.SelectedOutputText ? "large-text-preview" : "none";
  }
  return "fullscreen";
}
