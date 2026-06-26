import {
  createInternalOpenApiClient,
  TransportError,
  type InternalOpenApiClient,
} from "./http.js";
import type { components, paths } from "./schema/admin.js";

export type AdminProviderSnapshot = components["schemas"]["InternalModelProvider"];

export interface AdminClientOptions {
  baseUrl: string;
  internalToken: string;
  timeoutMs?: number;
}

export class AdminInternalClient {
  private readonly client: InternalOpenApiClient<paths>;

  constructor(options: AdminClientOptions) {
    this.client = createInternalOpenApiClient<paths>({ ...options, service: "admin" });
  }

  async getDefaultProvider(userId: string): Promise<AdminProviderSnapshot> {
    const { data, error, response } = await this.client.GET("/internal/providers/default", {
      params: { query: { user_id: userId } },
    });
    if (data) return data;
    throw toTransportError(response, error);
  }

  async getProvider(userId: string, providerId: string): Promise<AdminProviderSnapshot> {
    const { data, error, response } = await this.client.GET("/internal/providers/{provider_id}", {
      params: { path: { provider_id: providerId }, query: { user_id: userId } },
    });
    if (data) return data;
    throw toTransportError(response, error);
  }
}

function toTransportError(response: Response, error: unknown): TransportError {
  return new TransportError("admin", response.status, `admin request failed: ${response.status}`, error);
}
