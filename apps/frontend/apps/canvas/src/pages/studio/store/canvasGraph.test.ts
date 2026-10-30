import { CanvasGenerationStatus, CanvasNodeStatus, CanvasNodeTaskType, type CanvasNode } from "@repo/api";
import { createStore } from "jotai";
import { expect, it } from "vitest";

import { canvasNodesAtom, canvasGenerationRuntimeStatesAtom, installCanvasProjectionAtom } from "./canvasGraph";
import { applyCanvasPatch, projectionFromSnapshot } from "./streamProjection";

const node: CanvasNode = {
  node_id: "n",
  canvas_id: "c",
  canvas_node_no: 0,
  name: "node",
  type: 1,
  revision: 1,
  created_at: "",
  updated_at: "",
  created_by: "u",
  updated_by: "u",
  prompt: "",
  position: { position_x: 0, position_y: 0 },
  reference_status: 1,
  status: CanvasNodeStatus.READY,
  incoming_edges: [],
  selected_asset_id: "asset",
};
const initial = (value: CanvasNode, taskType: (typeof CanvasNodeTaskType)[keyof typeof CanvasNodeTaskType]) =>
  projectionFromSnapshot({
    canvas: {
      canvas_id: "c",
      project_id: "p",
      name: "test",
      revision: 1,
      created_at: "",
      updated_at: "",
      created_by: "u",
      default_view: 1,
      stats: { canvas_node_count: 1, selected_video_duration_millis: 0 },
    },
    cursor: 1,
    nodes: [value],
    tasks: [
      {
        node_id: "n",
        task_run_id: "t",
        task_type: taskType,
        status: CanvasGenerationStatus.RUNNING,
        error_code: "",
        error_message: "",
        seedance_task_id: "",
      },
    ],
    texts: [],
    archives: [],
    protected_node_ids: ["n"],
  });
it("derives asset matching without presenting it as media generation", () => {
  const store = createStore();
  store.set(
    installCanvasProjectionAtom,
    initial({ ...node, active_task_run_id: "t", status: CanvasNodeStatus.GENERATING }, CanvasNodeTaskType.ASSETS_MATCH),
  );
  expect(store.get(canvasNodesAtom)[0]?.Status).toBe(CanvasNodeStatus.READY);
  expect(store.get(canvasNodesAtom)[0]?.ActiveTaskType).toBe(CanvasNodeTaskType.ASSETS_MATCH);
  expect(store.get(canvasGenerationRuntimeStatesAtom).size).toBe(0);
});
it("keeps generation pending during frame extraction and finishes on a task-only event", () => {
  const store = createStore();
  const state = initial(node, CanvasNodeTaskType.GENERATION);
  store.set(installCanvasProjectionAtom, state);
  expect(store.get(canvasNodesAtom)[0]?.ActiveTaskRunID).toBe("t");
  expect(store.get(canvasNodesAtom)[0]?.Status).toBe(CanvasNodeStatus.GENERATING);
  expect(store.get(canvasGenerationRuntimeStatesAtom).get("n")?.taskRunId).toBe("t");
  const final = applyCanvasPatch(state, {
    protocol_version: 3,
    base_cursor: 1,
    cursor: 2,
    occurred_at: "",
    request_id: "",
    action: "",
    operations: [
      {
        kind: "task.upsert",
        key: "t",
        node_id: "n",
        task: { ...state.tasks.get("t")!, status: CanvasGenerationStatus.SUCCEEDED },
      },
    ],
  });
  store.set(installCanvasProjectionAtom, final);
  expect(store.get(canvasNodesAtom)[0]?.ActiveTaskRunID).toBeUndefined();
  expect(store.get(canvasNodesAtom)[0]?.Status).toBe(CanvasNodeStatus.READY);
  expect(store.get(canvasGenerationRuntimeStatesAtom).size).toBe(0);
});
