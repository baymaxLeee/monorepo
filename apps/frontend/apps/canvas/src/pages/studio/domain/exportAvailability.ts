import { canvasnode } from "@/domain";

type CanvasVideoExportCandidate = Pick<
  canvasnode.CanvasNode,
  "SelectedAssetID" | "SelectedOutputID" | "Status" | "Type"
>;

export function hasExportableCanvasVideo(nodes: CanvasVideoExportCandidate[]) {
  return nodes.some(
    (node) =>
      node.Type === canvasnode.CanvasNodeType.VIDEO_GENERATION &&
      node.Status === canvasnode.CanvasNodeStatus.READY &&
      Boolean(node.SelectedAssetID || node.SelectedOutputID),
  );
}
