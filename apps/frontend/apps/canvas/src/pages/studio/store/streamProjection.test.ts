import type { CanvasGetCanvasGraphResponse, CanvasPatchEvent } from "@repo/api";
import { describe, expect, it } from "vitest";

import { applyCanvasPatch, projectionFromSnapshot } from "./streamProjection";

const snapshot = (): CanvasGetCanvasGraphResponse => ({
  canvas: {
    canvas_id: "c",
    project_id: "p",
    name: "test",
    created_by: "u",
    created_at: "",
    updated_at: "",
    stats: { canvas_node_count: 0, selected_video_duration_millis: 0 },
    default_view: 1,
    revision: 1,
  },
  archives: [],
  cursor: 1,
  nodes: [],
  tasks: [],
  texts: [],
  protected_node_ids: [],
});
const event = (operations: CanvasPatchEvent["operations"], base = 1): CanvasPatchEvent => ({
  protocol_version: 3,
  base_cursor: base,
  cursor: base + 1,
  occurred_at: "",
  request_id: "",
  action: "",
  operations,
});
describe("Canvas operation log", () => {
  it("advances invisible barriers without clearing existing text", () => {
    const state = projectionFromSnapshot({
      ...snapshot(),
      texts: [{ node_id: "n", task_run_id: "t", content: "你好", offset: 6, status: "running" }],
    });
    const next = applyCanvasPatch(state, event([]));
    expect(next.cursor).toBe(2);
    expect(next.texts.get("n")?.content).toBe("你好");
  });
  it("rejects a cursor gap and does not apply half of a malformed frame", () => {
    const state = projectionFromSnapshot(snapshot());
    expect(() => applyCanvasPatch(state, event([], 2))).toThrow();
    expect(() =>
      applyCanvasPatch(
        state,
        event([
          {
            kind: "text.append",
            key: "n",
            node_id: "n",
            text_delta: { node_id: "n", task_run_id: "t", content: "你", start_offset: 0, end_offset: 3 },
          },
          {
            kind: "text.append",
            key: "n",
            node_id: "n",
            text_delta: { node_id: "n", task_run_id: "t", content: "好", start_offset: 1, end_offset: 4 },
          },
        ]),
      ),
    ).toThrow();
    expect(state.cursor).toBe(1);
    expect(state.texts.size).toBe(0);
  });
  it("uses UTF-8 bytes and accepts terminal status only at the exact checkpoint", () => {
    const state = applyCanvasPatch(
      projectionFromSnapshot(snapshot()),
      event([
        {
          kind: "text.append",
          key: "n",
          node_id: "n",
          text_delta: { node_id: "n", task_run_id: "t", content: "你好", start_offset: 0, end_offset: 6 },
        },
        {
          kind: "text.status",
          key: "n",
          node_id: "n",
          text_status: { node_id: "n", task_run_id: "t", status: "succeeded", offset: 6 },
        },
      ]),
    );
    expect(state.texts.get("n")?.content).toBe("你好");
    expect(() =>
      applyCanvasPatch(
        state,
        event(
          [
            {
              kind: "text.status",
              key: "n",
              node_id: "n",
              text_status: { node_id: "n", task_run_id: "t", status: "failed", offset: 3 },
            },
          ],
          2,
        ),
      ),
    ).toThrow();
  });
});

it("installs metadata and archive changes in the same cursor without another HTTP read", () => {
  const before = projectionFromSnapshot(snapshot());
  const archive = {
    task_run_id: "a",
    canvas_id: "c",
    project_id: "p",
    status: 1 as const,
    input_count: 2,
    output_filename: "videos.zip",
    output_size: 0,
    created_at: "",
  };
  const next = applyCanvasPatch(
    before,
    event([
      { kind: "canvas.upsert", key: "c", canvas: { ...before.canvas, name: "renamed", revision: 2 } },
      { kind: "archive.upsert", key: "a", archive },
    ]),
  );
  expect(next.canvas.name).toBe("renamed");
  expect(next.archives.get("a")).toEqual(archive);
  expect(before.canvas.name).toBe("test");
  expect(() =>
    applyCanvasPatch(
      next,
      event([{ kind: "canvas.upsert", key: "other", canvas: { ...next.canvas, canvas_id: "other" } }], 2),
    ),
  ).toThrow();
  expect(applyCanvasPatch(next, event([{ kind: "archive.remove", key: "a" }], 2)).archives.size).toBe(0);
});
