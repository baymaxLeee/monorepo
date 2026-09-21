import { canvasnode } from "@/domain";

import {
  type CanvasNodeInputResolution,
  type CanvasNodePortCounts,
  canvasNodeProtocol,
  resolveCanvasNodeConnection,
} from "./nodeProtocol";

export type CanvasGraphEdge = { source: string; target: string };

export function canvasNodeGraphEdges(
  nodes: readonly Pick<canvasnode.CanvasNode, "IncomingEdges" | "NodeID">[],
): CanvasGraphEdge[] {
  return nodes.flatMap((target) =>
    target.IncomingEdges.map((edge) => ({
      source: edge.SourceNodeID,
      target: target.NodeID,
    })),
  );
}

export function canvasConnectionCreatesCycle(
  edges: readonly CanvasGraphEdge[],
  sourceNodeID: string,
  targetNodeID: string,
) {
  if (sourceNodeID === targetNodeID) return true;
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = outgoing.get(edge.source) ?? [];
    targets.push(edge.target);
    outgoing.set(edge.source, targets);
  }
  const pending = [targetNodeID];
  const visited = new Set<string>();
  while (pending.length) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    if (current === sourceNodeID) return true;
    visited.add(current);
    pending.push(...(outgoing.get(current) ?? []));
  }
  return false;
}

/** 组合 Port policy 与独立 graph policy，供所有节点连线入口复用。 */
export function resolveCanvasConnection(
  source: Pick<canvasnode.CanvasNode, "NodeID" | "Type"> & Partial<Pick<canvasnode.CanvasNode, "ReferenceStatus">>,
  target: Pick<canvasnode.CanvasNode, "IncomingEdges" | "NodeID" | "Type" | "VideoInputMode"> &
    Partial<Pick<canvasnode.CanvasNode, "ActiveTaskRunID" | "ReferenceStatus">>,
  edges: readonly CanvasGraphEdge[],
  options: {
    slotCounts?: CanvasNodePortCounts;
    preferredPort?: canvasnode.CanvasPort;
  } = {},
): CanvasNodeInputResolution {
  if (
    source.ReferenceStatus === canvasnode.CanvasNodeReferenceStatus.DELETED ||
    target.ReferenceStatus === canvasnode.CanvasNodeReferenceStatus.DELETED
  ) {
    return {
      accepted: false,
      media: canvasNodeProtocol(source.Type).output.dataType,
      reason: "deleted-reference",
    };
  }
  const resolution = resolveCanvasNodeConnection(source, target, options);
  if (resolution.accepted && canvasConnectionCreatesCycle(edges, source.NodeID, target.NodeID)) {
    return {
      accepted: false,
      media: canvasNodeProtocol(source.Type).output.dataType,
      reason: "cycle",
    };
  }
  return resolution;
}
