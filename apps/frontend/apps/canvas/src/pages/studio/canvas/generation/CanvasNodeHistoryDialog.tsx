import { useSetAtom } from "jotai";
import { useState } from "react";

import { Message } from "@/components/ui";
import { canvasnode } from "@/domain";
import { SelectCanvasNodeHistory } from "@/pages/studio/domain/generations";
import t from "@/utils/i18n";

import { GenerationHistoryDialog } from "../../components/GenerationHistoryDialog";
import type { GenerationHistoryItem } from "../../domain/types";
import { clearCanvasGenerationFailureAtom, patchCanvasNodeAtom } from "../../store/index";

export function CanvasNodeHistoryDialog({
  canvasId,
  projectId,
  item,
  onClose,
  shotIndex,
}: {
  canvasId: string;
  projectId: string;
  item?: canvasnode.CanvasNode;
  onClose: () => void;
  shotIndex: number;
}) {
  const [historySelecting, setHistorySelecting] = useState(false);
  const patchCanvasNode = useSetAtom(patchCanvasNodeAtom);
  const clearCanvasGenerationFailure = useSetAtom(clearCanvasGenerationFailureAtom);
  const historyItem =
    item?.Type === canvasnode.CanvasNodeType.IMAGE_GENERATION ||
    item?.Type === canvasnode.CanvasNodeType.VIDEO_GENERATION ||
    item?.Type === canvasnode.CanvasNodeType.TEXT_GENERATION
      ? item
      : undefined;
  return (
    <GenerationHistoryDialog
      currentHistoryId={historyItem?.SelectedOutputID}
      canvasId={canvasId}
      canvasTitle={historyItem?.Name}
      onCancel={() => onClose()}
      onSelectHistory={(history: GenerationHistoryItem) => {
        if (!historyItem || historySelecting) return;
        setHistorySelecting(true);
        void SelectCanvasNodeHistory(
          {
            ProjectID: projectId,
            CanvasID: canvasId,
            NodeID: historyItem.NodeID,
            HistoryID: history.id,
          },
          { skipErrorNotify: true },
        )
          .then((response) => {
            patchCanvasNode({
              nodeId: historyItem.NodeID,
              patch: {
                Status: canvasnode.CanvasNodeStatus.READY,
                SelectedOutputText: response.History.OutputText,
                CurrentAssetID: response.History.OutputAssetID,
                ResourceID: undefined,
                ResourceAssetID: undefined,
                ResourceAssetIsPrimary: undefined,
                ResourceAssetRevision: undefined,
                SelectedOutputID: response.History.HistoryID,
                SelectedAssetID: response.History.OutputAssetID,
                SelectedOutputURL: response.History.OutputURL ?? response.History.VideoURL,
                SelectedOutputDurationSeconds: response.History.DurationSeconds,
                FirstFrameAssetID: response.History.FirstFrameAssetID,
                LastFrameAssetID: response.History.LastFrameAssetID,
                FirstFrameURL: response.History.FirstFrameURL,
              },
            });
            clearCanvasGenerationFailure(historyItem.NodeID);
            onClose();
            Message.success(
              t(
                historyItem.Type === canvasnode.CanvasNodeType.TEXT_GENERATION
                  ? "已选用该文本"
                  : historyItem.Type === canvasnode.CanvasNodeType.IMAGE_GENERATION
                    ? "已选用该图片"
                    : "已选用该视频",
              ),
            );
          })
          .finally(() => setHistorySelecting(false));
      }}
      projectId={projectId}
      canvasnodeId={historyItem?.NodeID}
      selecting={historySelecting}
      shotIndex={shotIndex}
      visible={Boolean(historyItem)}
    />
  );
}
