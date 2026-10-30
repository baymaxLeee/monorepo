import assert from "node:assert/strict";
import test from "node:test";

import { CanvasInternalClient } from "./canvas.js";

test("Canvas snapshot retains the cursor and task/draft facts for authenticated agent reads", async () => {
  const originalFetch = globalThis.fetch;
  const snapshot = {
    cursor: 12,
    canvas: { canvas_id: "c" },
    nodes: [{ node_id: "n", draft_session: { task_run_id: "draft" } }],
    tasks: [{ task_run_id: "run", status: 2 }],
    texts: [{ task_run_id: "run", content: "你好", offset: 6 }],
    archives: [],
    protected_node_ids: ["n"],
  };
  let request: Request | undefined;
  globalThis.fetch = async (input) => {
    request = input as Request;
    return Response.json(snapshot);
  };
  try {
    const client = new CanvasInternalClient({
      baseUrl: "http://canvas.internal",
      internalToken: "test-token",
      callerService: "chat",
    });
    const controller = new AbortController();
    const actual = await client.graph(
      { tenantId: "tenant", workspaceId: "workspace", workspaceRole: "member", userId: "user" },
      "p",
      "c",
      controller.signal,
    );
    assert.deepEqual(actual, snapshot);
    assert.equal(request?.url, "http://canvas.internal/projects/p/canvases/c/nodes");
    assert.equal(request?.headers.get("X-Auth-User-ID"), "user");
    assert.equal(request?.headers.get("X-Auth-Tenant-ID"), "tenant");
    assert.equal(request?.headers.get("X-Auth-Workspace-ID"), "workspace");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
