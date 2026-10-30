import type { CanvasNode, CanvasPatchEvent } from "@repo/api";
import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { expect, it } from "vitest";

import { AssetDraftProvider, useActiveAssets, useStudioAssetStore } from "./assets";
import { canvasNodesAtom, installCanvasProjectionAtom } from "./canvasGraph";
import { applyCanvasPatch, projectionFromSnapshot } from "./streamProjection";

const node = (id: string): CanvasNode => ({
  node_id: id,
  canvas_id: "c",
  canvas_node_no: 0,
  name: id,
  type: 1,
  revision: 1,
  created_at: "",
  updated_at: "",
  created_by: "u",
  updated_by: "u",
  prompt: "",
  position: { position_x: 0, position_y: 0 },
  reference_status: 1,
  status: 1,
  incoming_edges: [],
});
it("keeps edit drafts local while connected media and reviews follow SSE", () => {
  const store = createStore();
  const source = { ...node("source"), asset_id: "asset" };
  const target = {
    ...node("target"),
    incoming_edges: [
      { edge_id: "edge", source_node_id: "source", source_port: 1 as const, target_port: 1 as const, target_order: 0 },
    ],
  };
  const initial = projectionFromSnapshot({
    canvas: {
      canvas_id: "c",
      project_id: "p",
      name: "test",
      revision: 1,
      created_at: "",
      updated_at: "",
      created_by: "u",
      default_view: 1,
      stats: { canvas_node_count: 0, selected_video_duration_millis: 0 },
    },
    cursor: 1,
    nodes: [source, target],
    tasks: [],
    texts: [],
    archives: [],
    protected_node_ids: [],
  });
  store.set(installCanvasProjectionAtom, initial);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <AssetDraftProvider>{children}</AssetDraftProvider>
    </Provider>
  );
  const { result } = renderHook(() => ({ draft: useStudioAssetStore(), assets: useActiveAssets() }), { wrapper });
  act(() => {
    result.current.draft.setActiveShot("target");
    result.current.draft.beginDraft("target");
    result.current.draft.updateDraft("target", (items) => [
      ...items,
      { id: "draft-local", category: "image", title: "upload", description: "", syncStatus: "uploading" },
    ]);
  });
  expect(result.current.assets.map((item) => item.id)).toEqual(["source", "draft-local"]);
  expect(store.get(canvasNodesAtom)).toHaveLength(2);
  const frame: CanvasPatchEvent = {
    protocol_version: 3,
    base_cursor: 1,
    cursor: 2,
    occurred_at: "",
    request_id: "",
    action: "",
    operations: [
      {
        kind: "node_reviews.upsert",
        key: "source",
        node_id: "source",
        node_reviews: {
          node_id: "source",
          asset_id: "asset",
          reviews: [{ package_id: "package", package_name: "review", status: 3, updated_at: "now" }],
        },
      },
    ],
  };
  act(() => store.set(installCanvasProjectionAtom, applyCanvasPatch(initial, frame)));
  expect(result.current.assets[0]?.reviews?.[0]?.Status).toBe(3);
  expect(result.current.assets[1]?.id).toBe("draft-local");
  expect(() =>
    applyCanvasPatch(initial, {
      ...frame,
      operations: [
        { ...frame.operations[0]!, node_reviews: { ...frame.operations[0]!.node_reviews!, asset_id: "different" } },
      ],
    }),
  ).toThrow();
  act(() => result.current.draft.clearDraft("target"));
  expect(result.current.assets.map((item) => item.id)).toEqual(["source"]);
  expect(result.current.assets[0]?.reviews?.[0]?.Status).toBe(3);
});
