import { createInternalOpenApiClient, TransportError, type InternalOpenApiClient } from "./http.js";
import type { components, paths } from "./schema/canvas.js";

export type CanvasGraph = components["schemas"]["CanvasGraph"];
export type CanvasMutation = components["schemas"]["CanvasMutation"];
export type CanvasNode = components["schemas"]["CanvasNode"];
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
  }) {
    this.client = createInternalOpenApiClient<paths>({
      ...options,
      baseUrl: `${options.baseUrl.replace(/\/$/, "")}/internal`,
      service: "canvas",
    });
  }
  async executeArchive(archiveId: string, signal?: AbortSignal) {
    const { data, error, response } = await this.client.POST("/worker/archives/{archiveId}/execute", {
      params: { path: { archiveId } },
      signal,
    });
    if (data) return data;
    throw new TransportError("canvas", response.status, `Canvas archive execution failed (${response.status})`, error);
  }
  private headers(actor: CanvasActor) {
    return {
      "X-Auth-User-ID": actor.userId,
      "X-Auth-Tenant-ID": actor.tenantId,
      "X-Auth-Workspace-ID": actor.workspaceId,
      "X-Auth-Workspace-Role": actor.workspaceRole,
    };
  }
  async graph(actor: CanvasActor, canvasId: string, signal?: AbortSignal): Promise<CanvasGraph> {
    const { data, error, response } = await this.client.GET("/canvases/{id}/graph", {
      params: { path: { id: canvasId } },
      headers: this.headers(actor),
      signal,
    });
    if (data) return data;
    throw new TransportError("canvas", response.status, `Canvas read failed (${response.status})`, error);
  }
  async startGeneration(
    actor: CanvasActor,
    canvasId: string,
    nodeId: string,
    input: components["schemas"]["CanvasStartGeneration"],
    signal?: AbortSignal,
  ) {
    const { data, error, response } = await this.client.POST("/canvases/{id}/nodes/{nodeId}/generations", {
      params: { path: { id: canvasId, nodeId } },
      headers: this.headers(actor),
      body: input,
      signal,
    });
    if (data) return data;
    throw new TransportError("canvas", response.status, `Canvas generation request failed (${response.status})`, error);
  }
  async listGenerations(actor: CanvasActor, canvasId: string, nodeId: string, signal?: AbortSignal) {
    const { data, error, response } = await this.client.GET("/canvases/{id}/nodes/{nodeId}/generations", {
      params: { path: { id: canvasId, nodeId } },
      headers: this.headers(actor),
      signal,
    });
    if (data) return data;
    throw new TransportError("canvas", response.status, `Canvas generation request failed (${response.status})`, error);
  }
  async cancelGeneration(actor: CanvasActor, canvasId: string, generationId: string, signal?: AbortSignal) {
    const { data, error, response } = await this.client.POST("/canvases/{id}/generations/{generationId}/cancel", {
      params: { path: { id: canvasId, generationId } },
      headers: this.headers(actor),
      signal,
    });
    if (data) return data;
    throw new TransportError("canvas", response.status, `Canvas generation request failed (${response.status})`, error);
  }
  async mutate(
    actor: CanvasActor,
    canvasId: string,
    input: CanvasMutation,
    signal?: AbortSignal,
  ): Promise<CanvasGraph> {
    const { data, error, response } = await this.client.POST("/canvases/{id}/mutations", {
      params: { path: { id: canvasId } },
      headers: this.headers(actor),
      body: input,
      signal,
    });
    if (data) return data;
    throw new TransportError(
      "canvas",
      response.status,
      response.status === 409
        ? "Canvas changed; read the current graph before retrying."
        : `Canvas mutation failed (${response.status})`,
      error,
    );
  }
}
