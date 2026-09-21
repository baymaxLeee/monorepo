import { createInternalOpenApiClient, TransportError, type InternalOpenApiClient } from "./http.js";
import type { components, paths } from "./schema/admin.js";

export type AdminProviderSnapshot = components["schemas"]["InternalModelProvider"];
export type AdminResolvedAgent = components["schemas"]["ResolvedAgent"];
export type AdminInternalSkill = components["schemas"]["InternalSkill"];
export type AdminInternalSkillFile = components["schemas"]["InternalSkillFile"];

export interface AdminClientOptions {
  baseUrl: string;
  internalToken: string;
  callerService: string;
  timeoutMs?: number;
  propagatedHeaders?: () => Record<string, string> | undefined;
}

export class AdminInternalClient {
  private readonly client: InternalOpenApiClient<paths>;

  constructor(options: AdminClientOptions) {
    this.client = createInternalOpenApiClient<paths>({ ...options, service: "admin" });
  }

  async getDefaultProvider(tenantId: string, workspaceId: string): Promise<AdminProviderSnapshot> {
    const { data, error, response } = await this.client.GET("/internal/providers/default", {
      params: { query: { tenant_id: tenantId, workspace_id: workspaceId } },
    });
    if (data) {
      return data;
    }
    throw toTransportError(response, error);
  }

  async getProvider(providerId: string, tenantId: string, workspaceId: string): Promise<AdminProviderSnapshot> {
    const { data, error, response } = await this.client.GET("/internal/providers/{provider_id}", {
      params: { path: { provider_id: providerId }, query: { tenant_id: tenantId, workspace_id: workspaceId } },
    });
    if (data) {
      return data;
    }
    throw toTransportError(response, error);
  }

  async getResolvedAgent(
    userId: string,
    agentId: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<AdminResolvedAgent> {
    const { data, error, response } = await this.client.GET("/internal/agents/{agent_id}", {
      params: {
        path: { agent_id: agentId },
        query: { user_id: userId, tenant_id: tenantId, workspace_id: workspaceId },
      },
    });
    if (data) {
      return data;
    }
    throw toTransportError(response, error);
  }

  async getSkill(skillId: string, tenantId: string, workspaceId: string): Promise<AdminInternalSkill> {
    const { data, error, response } = await this.client.GET("/internal/skills/{skill_id}", {
      params: { path: { skill_id: skillId }, query: { tenant_id: tenantId, workspace_id: workspaceId } },
    });
    if (data) {
      return data;
    }
    throw toTransportError(response, error);
  }

  async getSkillFile(
    skillId: string,
    tenantId: string,
    workspaceId: string,
    path: string,
  ): Promise<AdminInternalSkillFile> {
    const { data, error, response } = await this.client.GET("/internal/skills/{skill_id}/files", {
      params: { path: { skill_id: skillId }, query: { tenant_id: tenantId, workspace_id: workspaceId, path } },
    });
    if (data) {
      return data;
    }
    throw toTransportError(response, error);
  }
}

function toTransportError(response: Response, error: unknown): TransportError {
  return new TransportError("admin", response.status, `admin request failed: ${response.status}`, error);
}
