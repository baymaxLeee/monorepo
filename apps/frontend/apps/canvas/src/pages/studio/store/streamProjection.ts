import {
  CanvasResyncRequired,
  type CanvasGetCanvasGraphResponse,
  type CanvasNode,
  type CanvasPatchEvent,
  type CanvasStreamTask,
  type CanvasTextCheckpoint,
} from "@repo/api";

export type CanvasProjection = {
  cursor: number;
  canvas: CanvasGetCanvasGraphResponse["canvas"];
  archives: Map<string, CanvasGetCanvasGraphResponse["archives"][number]>;
  nodes: Map<string, CanvasNode>;
  tasks: Map<string, CanvasStreamTask>;
  texts: Map<string, CanvasTextCheckpoint>;
  protected: Set<string>;
};
const bytes = (value: string) => new TextEncoder().encode(value).length;
function requireFrame(valid: unknown): asserts valid {
  if (!valid) throw new CanvasResyncRequired("画布增量不连续，需要恢复快照");
}
export function projectionFromSnapshot(value: CanvasGetCanvasGraphResponse): CanvasProjection {
  requireFrame(Number.isSafeInteger(value.cursor) && value.cursor > 0);
  const texts = new Map<string, CanvasTextCheckpoint>();
  for (const text of value.texts) {
    requireFrame(bytes(text.content) === text.offset);
    texts.set(text.node_id, text);
  }
  requireFrame(value.canvas?.canvas_id && Array.isArray(value.archives));
  return {
    canvas: value.canvas,
    archives: new Map(value.archives.map((a) => [a.task_run_id, a])),
    cursor: value.cursor,
    nodes: new Map(value.nodes.map((n) => [n.node_id, n])),
    tasks: new Map(value.tasks.map((t) => [t.task_run_id, t])),
    texts,
    protected: new Set(value.protected_node_ids),
  };
}
const assetID = (node: CanvasNode) => node.asset_id || node.current_asset_id || node.selected_asset_id;

/** Validate and reduce a complete frame on copies; callers install it once. */
export function applyCanvasPatch(current: CanvasProjection, event: CanvasPatchEvent): CanvasProjection {
  requireFrame(
    event &&
      event.protocol_version === 3 &&
      Number.isSafeInteger(event.cursor) &&
      event.base_cursor === current.cursor &&
      event.cursor === current.cursor + 1 &&
      Array.isArray(event.operations),
  );
  const next: CanvasProjection = {
    canvas: current.canvas,
    archives: new Map(current.archives),
    cursor: event.cursor,
    nodes: new Map(current.nodes),
    tasks: new Map(current.tasks),
    texts: new Map(current.texts),
    protected: new Set(current.protected),
  };
  const payloads = ["canvas", "archive", "node", "task", "text_delta", "text_status", "node_reviews"] as const;
  for (const op of event.operations) {
    requireFrame(op && typeof op.key === "string" && op.key);
    const canvasLevel = op.kind === "canvas.upsert" || op.kind === "archive.upsert" || op.kind === "archive.remove";
    if (!canvasLevel) requireFrame(typeof op.node_id === "string" && op.node_id);
    const expected = (
      {
        "canvas.upsert": "canvas",
        "archive.upsert": "archive",
        "node.upsert": "node",
        "task.upsert": "task",
        "text.append": "text_delta",
        "text.status": "text_status",
        "node_reviews.upsert": "node_reviews",
      } as Record<string, string>
    )[op.kind];
    requireFrame(payloads.every((key) => (expected === key ? op[key] != null : op[key] == null)));
    if (!canvasLevel && op.kind !== "task.upsert" && op.kind !== "task.remove") requireFrame(op.key === op.node_id);
    switch (op.kind) {
      case "canvas.upsert":
        requireFrame(op.canvas!.canvas_id === current.canvas.canvas_id && op.key === current.canvas.canvas_id);
        next.canvas = op.canvas!;
        break;
      case "archive.upsert":
        requireFrame(op.archive!.task_run_id === op.key && op.archive!.canvas_id === current.canvas.canvas_id);
        next.archives.set(op.key, op.archive!);
        break;
      case "archive.remove":
        next.archives.delete(op.key);
        break;
      case "node.upsert": {
        const node = op.node!;
        requireFrame(
          node.node_id === op.key &&
            Array.isArray(node.incoming_edges) &&
            node.position &&
            Number.isFinite(node.position.position_x) &&
            Number.isFinite(node.position.position_y),
        );
        const prior = next.nodes.get(op.key);
        next.nodes.set(op.key, { ...node, reviews: prior && assetID(prior) === assetID(node) ? prior.reviews : [] });
        break;
      }
      case "node.remove":
        next.nodes.delete(op.key);
        next.texts.delete(op.key);
        break;
      case "task.upsert":
        requireFrame(op.task!.task_run_id === op.key && op.task!.node_id === op.node_id);
        next.tasks.set(op.key, op.task!);
        break;
      case "task.remove":
        next.tasks.delete(op.key);
        break;
      case "protection.add":
        next.protected.add(op.key);
        break;
      case "protection.remove":
        next.protected.delete(op.key);
        break;
      case "text.append": {
        const delta = op.text_delta!;
        const previous = next.texts.get(op.key);
        const same = previous?.task_run_id === delta.task_run_id;
        requireFrame(
          delta.node_id === op.key &&
            delta.start_offset === (same ? previous.offset : 0) &&
            delta.end_offset === delta.start_offset + bytes(delta.content),
        );
        next.texts.set(op.key, {
          node_id: op.key,
          task_run_id: delta.task_run_id,
          content: (same ? previous.content : "") + delta.content,
          offset: delta.end_offset,
          status: same ? previous.status : "running",
        });
        break;
      }
      case "text.status": {
        const status = op.text_status!;
        const previous = next.texts.get(op.key);
        const same = previous?.task_run_id === status.task_run_id;
        requireFrame(status.node_id === op.key && status.offset === (same ? previous.offset : 0));
        next.texts.set(op.key, { ...status, content: same ? previous.content : "" });
        break;
      }
      case "node_reviews.upsert":
      case "node_reviews.remove":
        break;
      default:
        throw new CanvasResyncRequired("Unknown Canvas operation");
    }
  }
  // Review identities are checked after all entity operations in the atomic frame.
  for (const op of event.operations) {
    if (op.kind === "node_reviews.upsert") {
      const node = next.nodes.get(op.key);
      const reviews = op.node_reviews!;
      requireFrame(node && reviews.node_id === op.key && reviews.asset_id === assetID(node));
      next.nodes.set(op.key, { ...node, reviews: reviews.reviews });
    } else if (op.kind === "node_reviews.remove") {
      const node = next.nodes.get(op.key);
      if (node) next.nodes.set(op.key, { ...node, reviews: [] });
    }
  }
  return next;
}
