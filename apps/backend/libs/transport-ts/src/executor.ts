import {
  createInternalOpenApiClient,
  TransportError,
  type InternalOpenApiClient,
} from "./http.js";
import type { components, paths } from "./schema/executor.js";

export type Task = components["schemas"]["Task"];
export type CreateTaskInput = components["schemas"]["CreateTaskInput"];
export type VideoProductionProjection = components["schemas"]["VideoProductionProjection"];
export type ProductionDecision = components["schemas"]["ProductionDecision"];
export type VideoProductionDetail =
  paths["/video-productions/{id}"]["get"]["responses"][200]["content"]["application/json"];

export interface ExecutorClientOptions {
  baseUrl: string;
  internalToken: string;
  callerService: string;
  timeoutMs?: number;
  propagatedHeaders?: () => Record<string, string> | undefined;
}

export class ExecutorInternalClient {
  private readonly client: InternalOpenApiClient<paths>;

  constructor(options: ExecutorClientOptions) {
    this.client = createInternalOpenApiClient<paths>({ ...options, service: "executor" });
  }

  async startTask(input: CreateTaskInput): Promise<Task> {
    const { data, error, response } = await this.client.POST("/tasks", { body: input });
    if (data) return data;
    throw toTransportError(response, error);
  }

  async getTask(id: string, owner: { owner_service: string; owner_ref: string }): Promise<Task> {
    const { data, error, response } = await this.client.GET("/tasks/{id}", {
      params: {
        path: { id },
        query: {
          owner_service: owner.owner_service,
          owner_ref: owner.owner_ref,
        },
      },
    });
    if (data) return data;
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
    if (data) return data;
    throw toTransportError(response, error);
  }

  async getVideoProduction(id: string): Promise<VideoProductionDetail> {
    const { data, error, response } = await this.client.GET("/video-productions/{id}", {
      params: { path: { id } },
    });
    if (data) return data;
    throw toTransportError(response, error);
  }

  async decideVideoProduction(
    id: string,
    decision: ProductionDecision,
  ): Promise<VideoProductionProjection> {
    const { data, error, response } = await this.client.POST(
      "/video-productions/{id}/decisions",
      { params: { path: { id } }, body: decision },
    );
    if (data) return data;
    throw toTransportError(response, error);
  }
}

function toTransportError(response: Response, error: unknown): TransportError {
  return new TransportError(
    "executor",
    response.status,
    `executor request failed: ${response.status}`,
    error,
  );
}
