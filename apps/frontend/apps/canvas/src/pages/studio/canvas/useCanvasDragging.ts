import { type ReactFlowState, useStore } from "@xyflow/react";

const draggingByNodes = new WeakMap<ReactFlowState["nodes"], boolean>();

const selectDragging = (state: ReactFlowState) => {
  if (state.paneDragging) return true;
  let dragging = draggingByNodes.get(state.nodes);
  if (dragging === undefined) {
    dragging = state.nodes.some((node) => node.dragging);
    draggingByNodes.set(state.nodes, dragging);
  }
  return dragging;
};

// Subscribe to the boolean only, avoiding updates for every pointer position.
export function useCanvasDragging() {
  return useStore(selectDragging);
}
