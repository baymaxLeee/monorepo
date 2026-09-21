import { type ReactFlowState, useStore } from "@xyflow/react";

const selectDragging = (state: ReactFlowState) => state.paneDragging || state.nodes.some((node) => node.dragging);

// Subscribe to the boolean only, avoiding updates for every pointer position.
export function useCanvasDragging() {
  return useStore(selectDragging);
}
