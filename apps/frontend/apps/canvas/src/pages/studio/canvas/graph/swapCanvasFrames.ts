import { canvasnode } from "@/domain";
import { DeleteCanvasEdge, ConnectCanvasNodes } from "@/pages/studio/domain/persistence";

type FrameMutationResponse = canvasnode.DeleteCanvasEdgeResponse;

/** 调用方须将整个交换放入 Studio 写队列，避免空槽位期间插入其他写入。 */
export async function swapCanvasFrames({
  projectId,
  canvasId,
  item,
  onUpdate,
}: {
  projectId: string;
  canvasId: string;
  item: canvasnode.CanvasNode;
  onUpdate: (response: FrameMutationResponse) => void;
}) {
  if (
    item.ActiveTaskRunID ||
    item.ReferenceStatus === canvasnode.CanvasNodeReferenceStatus.DELETED ||
    item.Type !== canvasnode.CanvasNodeType.VIDEO_GENERATION ||
    item.VideoInputMode !== canvasnode.CanvasVideoInputMode.FIRST_LAST_FRAME
  )
    return;
  const first = item.IncomingEdges.find((edge) => edge.TargetPort === canvasnode.CanvasPort.FIRST_FRAME);
  const last = item.IncomingEdges.find((edge) => edge.TargetPort === canvasnode.CanvasPort.LAST_FRAME);
  if (!first || !last) return;

  const baseline = [first, last];
  let current = item;
  const apply = (response: FrameMutationResponse) => {
    current = response.TargetNode;
    onUpdate(response);
  };
  const deleteEdge = async (edge: canvasnode.CanvasEdge) => {
    apply(
      await DeleteCanvasEdge(
        {
          ProjectID: projectId,
          CanvasID: canvasId,
          TargetNodeID: item.NodeID,
          EdgeID: edge.EdgeID,
        },
        { skipErrorNotify: true },
      ),
    );
  };
  const connect = async (edge: canvasnode.CanvasEdge, targetPort: canvasnode.CanvasPort) => {
    apply(
      await ConnectCanvasNodes(
        {
          ProjectID: projectId,
          CanvasID: canvasId,
          TargetNodeID: item.NodeID,
          SourceNodeID: edge.SourceNodeID,
          TargetPort: targetPort,
        },
        { skipErrorNotify: true },
      ),
    );
  };

  try {
    // 两个槽位都释放后才能重连；只调整端口，不删除素材节点。
    for (const edge of baseline) await deleteEdge(edge);
    await connect(first, canvasnode.CanvasPort.LAST_FRAME);
    await connect(last, canvasnode.CanvasPort.FIRST_FRAME);
  } catch (error) {
    // 对已确认的部分写入做补偿。补偿失败仍向调用方抛错并刷新权威图。
    for (const edge of current.IncomingEdges) {
      const original = baseline.find((frame) => frame.SourceNodeID === edge.SourceNodeID);
      if (original && edge.TargetPort !== original.TargetPort) await deleteEdge(edge);
    }
    for (const edge of baseline) {
      if (
        !current.IncomingEdges.some(
          (existing) => existing.SourceNodeID === edge.SourceNodeID && existing.TargetPort === edge.TargetPort,
        )
      ) {
        await connect(edge, edge.TargetPort);
      }
    }
    throw error;
  }
}
