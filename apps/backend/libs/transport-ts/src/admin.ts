import {
  createInternalOpenApiClient,
  TransportError,
  type InternalOpenApiClient,
} from "./http.js";
import type { components, paths } from "./schema/admin.js";

export type AdminProviderSnapshot = components["schemas"]["InternalModelProvider"];
export type AdminResolvedAgent = components["schemas"]["ResolvedAgent"];

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

  async getDefaultProvider(orgId: string): Promise<AdminProviderSnapshot> {
    const { data, error, response } = await this.client.GET("/internal/providers/default", {
      params: { query: { org_id: orgId } },
    });
    if (data) return data;
    throw toTransportError(response, error);
  }

  async getProvider(providerId: string): Promise<AdminProviderSnapshot> {
    const { data, error, response } = await this.client.GET("/internal/providers/{provider_id}", {
      params: { path: { provider_id: providerId } },
    });
    if (data) return data;
    throw toTransportError(response, error);
  }

  async getResolvedAgent(userId: string, agentId: string, orgId = ""): Promise<AdminResolvedAgent> {
    const { data, error, response } = await this.client.GET("/internal/agents/{agent_id}", {
      params: { path: { agent_id: agentId }, query: { user_id: userId, org_id: orgId } },
    });
    if (data) return data;
    throw toTransportError(response, error);
  }
}

function toTransportError(response: Response, error: unknown): TransportError {
  return new TransportError("admin", response.status, `admin request failed: ${response.status}`, error);
}
