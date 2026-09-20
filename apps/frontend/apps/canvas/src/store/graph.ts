import type { CanvasBoard, CanvasGraph, CanvasNode } from "@repo/api";
import { atom } from "jotai";

interface GraphState {
  canvas: CanvasBoard | null;
  nodeIds: string[];
  nodesById: ReadonlyMap<string, CanvasNode>;
}

const graphStateAtom = atom<GraphState>({ canvas: null, nodeIds: [], nodesById: new Map() });
export const graphFailedAtom = atom(false);
export const graphRequestAtom = atom(0);
export const canvasNodesAtom = atom((get) => {
  const state = get(graphStateAtom);
  return state.nodeIds.map((id) => state.nodesById.get(id)!);
});
export const canvasGraphAtom = atom((get): CanvasGraph | null => {
  const state = get(graphStateAtom);
  return state.canvas ? { canvas: state.canvas, nodes: get(canvasNodesAtom) } : null;
});
export const storyboardNodesAtom = atom((get) =>
  get(canvasNodesAtom)
    .filter((node) => node.type === 6)
    .sort((a, b) => a.storyboard_rank - b.storyboard_rank || a.id.localeCompare(b.id)),
);

export const applyGraphAtom = atom(null, (get, set, next: CanvasGraph) => {
  const current = get(graphStateAtom);
  if (current.canvas && current.canvas.id === next.canvas.id && current.canvas.revision > next.canvas.revision) return;
  const nodesById = new Map(
    next.nodes.map((node) => {
      const previous = current.nodesById.get(node.id);
      return [node.id, previous?.revision === node.revision ? previous : node] as const;
    }),
  );
  set(graphStateAtom, { canvas: next.canvas, nodeIds: next.nodes.map((node) => node.id), nodesById });
  set(graphFailedAtom, false);
});

export function nodeAtom(id: string) {
  return atom((get) => get(graphStateAtom).nodesById.get(id));
}
