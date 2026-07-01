import {
  createInternalOpenApiClient,
  TransportError,
  type InternalOpenApiClient,
} from "./http.js";
import type { components, paths } from "./schema/executor.js";

export type Task = components["schemas"]["Task"];
export type CreateTaskInput = components["schemas"]["CreateTaskInput"];

export interface ExecutorClientOptions {
  baseUrl: string;
  internalToken: string;
  timeoutMs?: number;
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

  async getTask(id: string): Promise<Task> {
    const { data, error, response } = await this.client.GET("/tasks/{id}", {
      params: { path: { id } },
    });
    if (data) return data;
    throw toTransportError(response, error);
  }

  async cancelTask(id: string): Promise<Task> {
    const { data, error, response } = await this.client.POST("/tasks/{id}/cancel", {
      params: { path: { id } },
    });
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
