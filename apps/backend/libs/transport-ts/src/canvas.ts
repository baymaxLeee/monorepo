import { createInternalOpenApiClient, TransportError, type InternalOpenApiClient } from "./http.js";
import type { components, operations, paths } from "./schema/canvas.js";

export type CanvasNode = components["schemas"]["CanvasNode"];
export type CanvasGraph = components["schemas"]["CanvasGetCanvasGraphResponse"];
export type CanvasNodeStateTarget = components["schemas"]["CanvasNodeStateTarget"];
export type CanvasNodePatch = operations["canvasUpdateNode"]["requestBody"]["content"]["application/json"];
export type CanvasStoryboardDraftInput =
  operations["canvasStartStoryboardDrafts"]["requestBody"]["content"]["application/json"];
export type CanvasArchiveExecution =
  operations["canvasExecuteArchive"]["responses"][200]["content"]["application/json"];

export interface CanvasActor {
  userId: string;
  tenantId: string;
  workspaceId: string;
  workspaceRole: string;
}

export class CanvasInternalClient {
  private readonly client: InternalOpenApiClient<paths>;

  constructor(options: {
    baseUrl: string;
    internalToken: string;
    callerService: string;
    propagatedHeaders?: () => Record<string, string> | undefined;
    timeoutMs?: number;
  }) {
    const clientOptions = {
      ...options,
      baseUrl: options.baseUrl.replace(/\/$/, ""),
      service: "canvas",
    };
    this.client = createInternalOpenApiClient<paths>(clientOptions);
  }

  async executeArchive(archiveId: string, signal?: AbortSignal): Promise<CanvasArchiveExecution> {
    const { data, error, response } = await this.client.POST("/internal/worker/archives/{archiveId}/execute", {
      params: { path: { archiveId } },
      signal,
    });
    if (data) return data;
    return this.failure(response, "archive execution", error);
  }

  private headers(actor: CanvasActor) {
    return {
      "X-Auth-User-ID": actor.userId,
      "X-Auth-Tenant-ID": actor.tenantId,
      "X-Auth-Workspace-ID": actor.workspaceId,
      "X-Auth-Workspace-Role": actor.workspaceRole,
    };
  }

  private failure(response: Response, operation: string, error: unknown): never {
    throw new TransportError("canvas", response.status, `Canvas ${operation} failed (${response.status})`, error);
  }

  async graph(actor: CanvasActor, projectId: string, canvasId: string, signal?: AbortSignal): Promise<CanvasGraph> {
    const { data, error, response } = await this.client.GET("/projects/{projectId}/canvases/{canvasId}/nodes", {
      params: { path: { projectId, canvasId } },
      headers: this.headers(actor),
      signal,
    });
    if (data) return data;
    return this.failure(response, "read", error);
  }

  async nodeStates(
    actor: CanvasActor,
    projectId: string,
    canvasId: string,
    targets: CanvasNodeStateTarget[],
    signal?: AbortSignal,
  ) {
    const { data, error, response } = await this.client.POST(
      "/projects/{projectId}/canvases/{canvasId}/node-states:batchGet",
      {
        params: { path: { projectId, canvasId } },
        headers: this.headers(actor),
        body: { targets },
        signal,
      },
    );
    if (data) return data;
    return this.failure(response, "state read", error);
  }

  async startStoryboardDrafts(
    actor: CanvasActor,
    projectId: string,
    canvasId: string,
    input: CanvasStoryboardDraftInput,
    signal?: AbortSignal,
  ) {
    const { data, error, response } = await this.client.POST(
      "/projects/{projectId}/canvases/{canvasId}/storyboard-drafts",
      {
        params: { path: { projectId, canvasId } },
        headers: this.headers(actor),
        body: input,
        signal,
      },
    );
    if (data) return data;
    return this.failure(response, "storyboard draft start", error);
  }

  async generateNodes(
    actor: CanvasActor,
    projectId: string,
    canvasId: string,
    nodeIds: string[],
    signal?: AbortSignal,
  ) {
    const items: Array<{ node_id: string; task_run_id: string }> = [];
    for (const nodeId of nodeIds) {
      const { data, error, response } = await this.client.POST(
        "/projects/{projectId}/canvases/{canvasId}/nodes/{nodeId}/generations",
        { params: { path: { projectId, canvasId, nodeId } }, headers: this.headers(actor), signal },
      );
      if (!data) this.failure(response, "generation start", error);
      items.push({ node_id: nodeId, task_run_id: data.task_run_id });
    }
    return { items };
  }

  async updateNode(
    actor: CanvasActor,
    projectId: string,
    canvasId: string,
    nodeId: string,
    patch: CanvasNodePatch,
    signal?: AbortSignal,
  ) {
    const { data, error, response } = await this.client.PATCH(
      "/projects/{projectId}/canvases/{canvasId}/nodes/{nodeId}",
      {
        params: { path: { projectId, canvasId, nodeId } },
        headers: this.headers(actor),
        body: patch,
        signal,
      },
    );
    if (data) return data;
    return this.failure(response, "node update", error);
  }
}
