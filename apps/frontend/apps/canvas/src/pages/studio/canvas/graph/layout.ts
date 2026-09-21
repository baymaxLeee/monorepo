import dagre from "@dagrejs/dagre";
import type { Edge, Node, XYPosition } from "@xyflow/react";

export const CANVAS_NODE_LAYER_GAP = 200;
const LAYER_STAGGER = 56;
const NODE_GAP = 120;
const ISOLATED_NODE_GAP = 80;
const ISOLATED_COLUMN_GAP = 160;
const NEW_REGION_GAP = 240;

function sizeOf(node: Node) {
  // CSS owns node specifications; XYFlow's measurement is the layout source of truth.
  const width = node.measured?.width;
  const height = node.measured?.height;
  return width && height ? { width, height } : undefined;
}

export function hasMeasuredCanvasNodes(nodes: Node[]) {
  return nodes.every((node) => Boolean(sizeOf(node)));
}

/** 布局请求只能在本次新增节点全部同步到 React Flow 后消费。 */
export function hasCanvasLayoutSeedNodes(seedNodeIDs: readonly string[], nodes: ReadonlyArray<Pick<Node, "id">>) {
  const nodeIDs = new Set(nodes.map((node) => node.id));
  return seedNodeIDs.every((id) => nodeIDs.has(id));
}

export function connectedNodeIDs(seedNodeIDs: string[], nodes: Node[], edges: Edge[]) {
  const existing = new Set(nodes.map((node) => node.id));
  const adjacency = new Map<string, string[]>();
  edges.forEach((edge) => {
    if (!existing.has(edge.source) || !existing.has(edge.target)) return;
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
    adjacency.set(edge.target, [...(adjacency.get(edge.target) ?? []), edge.source]);
  });
  const selected = new Set(seedNodeIDs.filter((id) => existing.has(id)));
  const queue = [...selected];
  for (let index = 0; index < queue.length; index += 1) {
    for (const adjacent of adjacency.get(queue[index]) ?? []) {
      if (selected.has(adjacent)) continue;
      selected.add(adjacent);
      queue.push(adjacent);
    }
  }
  return selected;
}

export function layoutCanvasNodes(
  nodes: Node[],
  edges: Edge[],
  targetNodeIDs = new Set(nodes.map((node) => node.id)),
): Map<string, XYPosition> | undefined {
  const targets = nodes.filter((node) => targetNodeIDs.has(node.id));
  if (targets.length === 0 || !hasMeasuredCanvasNodes(targets)) return undefined;

  const targetEdges = edges.filter((edge) => targetNodeIDs.has(edge.source) && targetNodeIDs.has(edge.target));
  const connectedIDs = new Set(targetEdges.flatMap((edge) => [edge.source, edge.target]));
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "LR",
    ranksep: CANVAS_NODE_LAYER_GAP,
    nodesep: NODE_GAP,
  });
  targets.forEach((node) => {
    if (!connectedIDs.has(node.id)) return;
    graph.setNode(node.id, sizeOf(node)!);
  });
  targetEdges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  dagre.layout(graph);

  const layerXs = [
    ...new Set(targets.filter((node) => connectedIDs.has(node.id)).map((node) => graph.node(node.id).x)),
  ].sort((left, right) => left - right);
  const layerOffsetByX = new Map(layerXs.map((x, index) => [x, (index % 2) * LAYER_STAGGER]));

  const positions = new Map<string, XYPosition>();
  let connectedRight = 0;
  for (const node of targets) {
    if (!connectedIDs.has(node.id)) continue;
    const size = sizeOf(node)!;
    const layout = graph.node(node.id);
    const position = {
      x: layout.x - size.width / 2,
      // Stagger adjacent layers so connected nodes do not collapse into
      // perfectly horizontal lines after arranging the canvas.
      y: layout.y - size.height / 2 + (layerOffsetByX.get(layout.x) ?? 0),
    };
    positions.set(node.id, position);
    connectedRight = Math.max(connectedRight, position.x + size.width);
  }

  let isolatedTop = 0;
  const isolatedLeft = connectedIDs.size ? connectedRight + ISOLATED_COLUMN_GAP : 0;
  for (const node of targets) {
    if (connectedIDs.has(node.id)) continue;
    const size = sizeOf(node)!;
    positions.set(node.id, { x: isolatedLeft, y: isolatedTop });
    isolatedTop += size.height + ISOLATED_NODE_GAP;
  }

  const occupied = nodes.filter((node) => !targetNodeIDs.has(node.id));
  if (occupied.length === 0 || !hasMeasuredCanvasNodes(occupied)) return positions;
  const occupiedLeft = Math.min(...occupied.map((node) => node.position.x));
  const occupiedBottom = Math.max(...occupied.map((node) => node.position.y + sizeOf(node)!.height));
  const layoutLeft = Math.min(...[...positions.values()].map((item) => item.x));
  const layoutTop = Math.min(...[...positions.values()].map((item) => item.y));
  const offsetX = occupiedLeft - layoutLeft;
  const offsetY = occupiedBottom + NEW_REGION_GAP - layoutTop;
  positions.forEach((position, id) => {
    positions.set(id, { x: position.x + offsetX, y: position.y + offsetY });
  });
  return positions;
}
