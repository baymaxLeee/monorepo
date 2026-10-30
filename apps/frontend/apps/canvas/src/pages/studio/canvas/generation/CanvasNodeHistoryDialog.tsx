import { toast } from "@repo/design-system";
import { useState } from "react";

import { canvasnode } from "@/domain";
import { SelectCanvasNodeHistory } from "@/pages/studio/domain/generations";
import t from "@/utils/i18n";

import { GenerationHistoryDialog } from "../../components/GenerationHistoryDialog";
import type { GenerationHistoryItem } from "../../domain/types";

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
          .then(() => {
            onClose();
            toast.add({
              type: "success",

              title: t(
                historyItem.Type === canvasnode.CanvasNodeType.TEXT_GENERATION
                  ? "已选用该文本"
                  : historyItem.Type === canvasnode.CanvasNodeType.IMAGE_GENERATION
                    ? "已选用该图片"
                    : "已选用该视频",
              ),
            });
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
