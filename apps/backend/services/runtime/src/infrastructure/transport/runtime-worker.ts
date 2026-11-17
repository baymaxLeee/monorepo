import { EventSourceParserStream } from "eventsource-parser/stream";

import {
  createInternalOpenApiClient,
  InternalHttpClient,
  responseTransportError,
  TransportError,
  type InternalOpenApiClient,
} from "./http.js";
import type { components, paths } from "./schema/runtime-worker.js";

export type Task = components["schemas"]["Task"];
export type CreateTaskInput = components["schemas"]["CreateTaskInput"];
export type VideoProductionProjection = components["schemas"]["VideoProductionProjection"];
export type ProductionDecision = components["schemas"]["ProductionDecision"];
export type VideoProductionDetail =
  paths["/video-productions/{id}"]["get"]["responses"][200]["content"]["application/json"];
export type TaskWatchFrame = components["schemas"]["TaskWatchFrame"];

export interface RuntimeWorkerClientOptions {
  baseUrl: string;
  internalToken: string;
  callerService: string;
  timeoutMs?: number;
  propagatedHeaders?: () => Record<string, string> | undefined;
}

export class RuntimeWorkerClient {
  private readonly client: InternalOpenApiClient<paths>;
  private readonly http: InternalHttpClient;

  constructor(options: RuntimeWorkerClientOptions) {
    this.client = createInternalOpenApiClient<paths>({ ...options, service: "runtime-worker" });
    this.http = new InternalHttpClient({ ...options, service: "runtime-worker" });
  }

  async startTask(input: CreateTaskInput): Promise<Task> {
    const { data, error, response } = await this.client.POST("/tasks", { body: input });
    if (data) {
      return data;
    }
    throw toTransportError(response, error);
  }

  async cancelTask(id: string, owner: { owner_service: string; owner_ref: string }): Promise<Task> {
    const { data, error, response } = await this.client.POST("/tasks/{id}/cancel", {
      params: {
        path: { id },
        query: {
          owner_service: owner.owner_service,
          owner_ref: owner.owner_ref,
        },
      },
    });
    if (data) {
      return data;
    }
    throw toTransportError(response, error);
  }

  async *watchTask(
    id: string,
    owner: { owner_service: string; owner_ref: string },
    signal?: AbortSignal,
  ): AsyncGenerator<TaskWatchFrame> {
    const response = await this.http.requestStream({
      path: `/tasks/${encodeURIComponent(id)}/stream`,
      query: owner,
      headers: { Accept: "text/event-stream" },
      signal,
    });
    if (!response.body) {
      throw new TransportError("runtime-worker", response.status, "runtime worker task stream has no response body");
    }
    const events = response.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new EventSourceParserStream({ onError: "terminate", maxBufferSize: 1_048_576 }));
    for await (const event of events) {
      if (event.event === "snapshot") {
        yield JSON.parse(event.data) as TaskWatchFrame;
      }
    }
  }

  async getVideoProduction(id: string): Promise<VideoProductionDetail> {
    const { data, error, response } = await this.client.GET("/video-productions/{id}", {
      params: { path: { id } },
    });
    if (data) {
      return data;
    }
    throw toTransportError(response, error);
  }

  async decideVideoProduction(id: string, decision: ProductionDecision): Promise<VideoProductionProjection> {
    const { data, error, response } = await this.client.POST("/video-productions/{id}/decisions", {
      params: { path: { id } },
      body: decision,
    });
    if (data) {
      return data;
    }
    throw toTransportError(response, error);
  }
}

function toTransportError(response: Response, error: unknown): TransportError {
  return responseTransportError(
    "runtime-worker",
    response.url ? new URL(response.url).pathname : "unknown",
    response,
    error,
  );
}
