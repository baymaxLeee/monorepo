import { createHmac } from "node:crypto";

import type { JSONSchema7 } from "@ai-sdk/provider";
import { InnerApiCaller, InnerApiError, insecureChannelCredentials } from "@backend/inner-api/client";
import {
  AgentPluginServiceClient,
  ConfigurationServiceClient,
  type AgentPluginManifest as WireAgentPluginManifest,
  type ModelProvider,
  type GetSkillFileResponse,
  type GetSkillResponse,
  type ListProviderCatalogResponse,
  type ListSkillsResponse,
  type ResolveAgentPluginsResponse,
  ProviderKind,
  ProviderServiceClient,
} from "@backend/inner-api/gen/admin/v1/admin";
import type {
  AgentPluginManifest,
  McpToolContribution,
  PluginActivation,
  PluginSourceKind,
  PluginTrustLevel,
  ResolvedTurnPluginSnapshot,
} from "@repo/agent-runtime/plugins/types";
import type { AgentToolPlanning, AgentToolPolicy } from "@repo/agent-runtime/tools/types";

import { propagationHeaders } from "#runtime/foundation";
import type { LanguageProviderSnapshot } from "#runtime/provider-model";
import { assertPublicProviderUrl } from "#runtime/provider-url";

import { AdminUnavailableError, ProviderNotConfiguredError, RequestError } from "../../application/errors.js";
import { getServerSettings } from "../../config/server.js";
import { getRedisClient } from "../redis/index.js";

export interface ProviderSnapshot {
  id: string;
  userId: string;
  name: string;
  model: string;
  providerKind: string;
  baseUrl: string;
  apiKey: string;
  extraBody: Record<string, unknown>;
  contextWindow: number;
  maxOutputTokens: number;
  supportsImageInput: boolean;
  isDefault: boolean;
  isEnabled: boolean;
}

export interface ProviderLimits {
  contextWindow: number;
  maxOutputTokens: number;
}

type PlatformPluginCredentialSettings = Pick<
  ReturnType<typeof getServerSettings>,
  "internalApiToken" | "knowledgeServiceUrl" | "canvasServiceUrl"
>;

const platformMcpResources = {
  "knowledge@platform": { serverName: "knowledge", serviceUrl: "knowledgeServiceUrl", audience: "knowledge" },
  "canvas@platform": { serverName: "canvas", serviceUrl: "canvasServiceUrl", audience: "canvas" },
} as const;

const scopedIdentityHeaders = [
  "x-auth-user-id",
  "x-auth-tenant-id",
  "x-auth-workspace-id",
  "x-auth-workspace-role",
  "x-project-id",
  "x-canvas-id",
] as const;

interface TurnFence {
  runId: string;
  attemptEpoch: number | bigint;
}

function scopedHeader(headers: Readonly<Record<string, string>>, name: string): string {
  const entry = Object.entries(headers).find(([header]) => header.toLowerCase() === name);
  return entry?.[1] ?? "";
}

function platformScopeCredential(
  audience: string,
  headers: Readonly<Record<string, string>>,
  secret: string,
  token: TurnFence,
): string {
  const payload = ["v1", audience, token.runId, String(token.attemptEpoch)];
  for (const header of scopedIdentityHeaders) payload.push(scopedHeader(headers, header));
  const signature = createHmac("sha256", secret).update(payload.join("\n")).digest("base64url");
  return `v1.${signature}`;
}

/** Adds Runtime's workload credential only to the two fixed first-party MCP endpoints. */
export function attachPlatformMcpCredential(
  snapshot: ResolvedTurnPluginSnapshot,
  settings: PlatformPluginCredentialSettings,
): ResolvedTurnPluginSnapshot {
  const platformGrantKeys = new Set<string>();
  for (const resolved of snapshot.plugins) {
    const resource = platformMcpResources[resolved.manifest.id as keyof typeof platformMcpResources];
    if (!resource) continue;
    if (resolved.manifest.source !== "system" || resolved.manifest.trust !== "system") {
      throw new AdminUnavailableError(`${resolved.manifest.id} is not a trusted system release`);
    }
    const servers = resolved.manifest.mcpServers.filter((server) => server.name === resource.serverName);
    const expectedUrl = new URL("/mcp", settings[resource.serviceUrl]).toString();
    if (servers.length !== 1 || new URL(servers[0]!.url).toString() !== expectedUrl) {
      throw new AdminUnavailableError(`${resolved.manifest.id} does not target its configured platform MCP endpoint`);
    }
    platformGrantKeys.add(`${resolved.manifest.id}\u0000${resource.serverName}`);
  }
  return {
    ...snapshot,
    connectionGrants: snapshot.connectionGrants.map((grant) => {
      if (Object.keys(grant.headers).some((header) => header.toLowerCase() === "x-internal-token")) {
        throw new AdminUnavailableError("admin returned a reserved workload credential header");
      }
      const key = `${grant.pluginId}\u0000${grant.serverName}`;
      return platformGrantKeys.has(key)
        ? {
            ...grant,
            headers: {
              ...grant.headers,
              "X-Internal-Token": settings.internalApiToken,
            },
          }
        : { ...grant, headers: { ...grant.headers } };
    }),
  };
}

/** Binds every live grant to the exact lease owner; only first-party MCPs receive a signed identity scope. */
export function bindTurnPluginGrants(
  snapshot: ResolvedTurnPluginSnapshot,
  token: TurnFence,
): ResolvedTurnPluginSnapshot {
  const validEpoch =
    typeof token.attemptEpoch === "bigint"
      ? token.attemptEpoch >= 1n
      : Number.isSafeInteger(token.attemptEpoch) && token.attemptEpoch >= 1;
  if (!token.runId || !validEpoch) {
    throw new AdminUnavailableError("invalid Runtime Turn fence");
  }
  return {
    ...snapshot,
    connectionGrants: snapshot.connectionGrants.map((grant) => {
      const resource = platformMcpResources[grant.pluginId as keyof typeof platformMcpResources];
      const headers = {
        ...grant.headers,
        "X-Runtime-Turn-ID": token.runId,
        "X-Runtime-Attempt-Epoch": String(token.attemptEpoch),
      };
      if (!resource || grant.serverName !== resource.serverName) {
        return { ...grant, headers };
      }
      const internalToken = scopedHeader(headers, "x-internal-token");
      if (!internalToken) {
        throw new AdminUnavailableError(`${grant.pluginId} has no Runtime workload credential`);
      }
      return {
        ...grant,
        headers: {
          ...headers,
          "X-Runtime-Scope-Credential": platformScopeCredential(resource.audience, headers, internalToken, token),
        },
      };
    }),
  };
}

/** Desktop is outside the service trust domain and must never receive a platform workload credential. */
export function assertLocalPluginExecutionAllowed(snapshot: ResolvedTurnPluginSnapshot): ResolvedTurnPluginSnapshot {
  const systemPlugin = snapshot.plugins.find(
    ({ manifest }) => manifest.source === "system" || manifest.trust === "system",
  );
  if (systemPlugin) {
    throw new RequestError(`${systemPlugin.manifest.id} requires cloud Runtime execution`);
  }
  return snapshot;
}

function providerLimitsKey(tenantId: string, workspaceId: string, providerId: string | null): string {
  return `chat:provider-limits:${encodeURIComponent(tenantId)}:${encodeURIComponent(workspaceId)}:${encodeURIComponent(providerId ?? "default")}`;
}

function parseProviderLimits(value: string | null): ProviderLimits | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as Partial<ProviderLimits>;
    return typeof parsed.contextWindow === "number" &&
      Number.isFinite(parsed.contextWindow) &&
      parsed.contextWindow > 0 &&
      typeof parsed.maxOutputTokens === "number" &&
      Number.isFinite(parsed.maxOutputTokens) &&
      parsed.maxOutputTokens >= 0
      ? {
          contextWindow: parsed.contextWindow,
          maxOutputTokens: parsed.maxOutputTokens,
        }
      : null;
  } catch {
    return null;
  }
}

/** L1 workspace skill listing advertised in `<available_skills>`. */
export interface SkillSummary {
  id: string;
  name: string;
  description: string;
}

export type SkillFileResource =
  | { storageKind: "inline"; mimeType: string | null; content: string }
  | {
      storageKind: "asset";
      mimeType: string | null;
      assetId: string;
      revisionId: string;
      sizeBytes: number;
      sha256: string;
      url: string;
    };

export interface ProviderCatalogItem {
  id: string;
  name: string;
  model: string;
  providerKind: string;
  isDefault: boolean;
  isEnabled: boolean;
}

function adminClient() {
  const settings = getServerSettings();
  return {
    providers: new ProviderServiceClient(settings.adminRpcTarget, insecureChannelCredentials),
    configuration: new ConfigurationServiceClient(settings.adminRpcTarget, insecureChannelCredentials),
    plugins: new AgentPluginServiceClient(settings.adminRpcTarget, insecureChannelCredentials),
    caller: new InnerApiCaller("runtime"),
  };
}

function pluginManifest(value: WireAgentPluginManifest): AgentPluginManifest {
  return {
    schemaVersion: value.schemaVersion as 1,
    id: value.pluginId,
    version: value.version,
    digest: value.digest,
    displayName: value.displayName,
    description: value.description,
    source: value.source as PluginSourceKind,
    trust: value.trust as PluginTrustLevel,
    mcpServers: value.mcpServers.map((server) => ({
      name: server.name,
      url: server.url,
      ...(server.requiredBindings.length > 0 ? { requiredBindings: server.requiredBindings } : {}),
      ...(server.optionalBindings.length > 0 ? { optionalBindings: server.optionalBindings } : {}),
      tools: server.tools.map((tool): McpToolContribution => {
        if (!tool.policy || !tool.planning || !tool.inputSchema) {
          throw new AdminUnavailableError(`admin returned incomplete tool metadata for ${value.pluginId}/${tool.name}`);
        }
        return {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as JSONSchema7,
          ...(tool.outputSchema ? { outputSchema: tool.outputSchema as JSONSchema7 } : {}),
          policy: {
            capability: tool.policy.capability,
            ...(tool.policy.callableByCodeMode ? { callableByCodeMode: true } : {}),
            effect: tool.policy.effect,
            trust: tool.policy.trust,
            execution: tool.policy.execution,
            ...(tool.policy.sourceProjection
              ? { sourceProjection: tool.policy.sourceProjection as AgentToolPolicy["sourceProjection"] }
              : {}),
            ...(tool.policy.streaming ? { streaming: true } : {}),
            ...(tool.policy.uiKind ? { uiKind: tool.policy.uiKind as AgentToolPolicy["uiKind"] } : {}),
          } as Omit<AgentToolPolicy, "source" | "pluginId">,
          planning: {
            summary: tool.planning.summary,
            ...(tool.planning.constraints.length > 0 ? { constraints: tool.planning.constraints } : {}),
            ...(tool.planning.prerequisites.length > 0 ? { prerequisites: tool.planning.prerequisites } : {}),
            ...(tool.planning.parallelizable ? { parallelizable: true } : {}),
          } satisfies AgentToolPlanning,
        };
      }),
    })),
    ...(value.skills.length > 0
      ? {
          skills: value.skills.map((skill) => ({
            id: skill.id,
            name: skill.name,
            description: skill.description,
            assetId: skill.assetId,
            revisionId: skill.revisionId,
            sha256: skill.sha256,
          })),
        }
      : {}),
  };
}

/** Resolves one Turn-frozen plugin snapshot. Credentials are never cached or persisted here. */
export async function resolveAgentPlugins(
  userId: string,
  tenantId: string,
  workspaceId: string,
  workspaceRole: string,
  activations: readonly PluginActivation[],
): Promise<ResolvedTurnPluginSnapshot> {
  try {
    const client = adminClient();
    const response = await client.caller.unary<ResolveAgentPluginsResponse>(
      (metadata, options, callback) =>
        client.plugins.resolveAgentPlugins(
          {
            actor: actor(userId, tenantId, workspaceId),
            workspaceRole,
            activations: activations.map((activation) => ({
              pluginId: activation.pluginId,
              bindings: { ...(activation.bindings ?? {}) },
            })),
          },
          metadata,
          options,
          callback,
        ),
      { headers: propagationHeaders() },
    );
    const snapshot = response.snapshot;
    if (!snapshot?.resolvedAt) {
      throw new AdminUnavailableError("admin returned no resolved plugin snapshot");
    }
    const resolvedSnapshot: ResolvedTurnPluginSnapshot = {
      schemaVersion: snapshot.schemaVersion as 1,
      snapshotId: snapshot.snapshotId,
      snapshotDigest: snapshot.snapshotDigest,
      workspaceRevision: snapshot.workspaceRevision,
      tenantId: snapshot.tenantId,
      workspaceId: snapshot.workspaceId,
      resolvedAt: snapshot.resolvedAt,
      plugins: snapshot.plugins.map((resolved) => {
        if (!resolved.manifest || !resolved.activation) {
          throw new AdminUnavailableError("admin returned an incomplete resolved plugin");
        }
        return {
          manifest: pluginManifest(resolved.manifest),
          activation: {
            pluginId: resolved.activation.pluginId,
            ...(Object.keys(resolved.activation.bindings).length > 0 ? { bindings: resolved.activation.bindings } : {}),
          },
        };
      }),
      connectionGrants: snapshot.connectionGrants.map((grant) => ({
        pluginId: grant.pluginId,
        serverName: grant.serverName,
        headers: grant.headers,
        ...(grant.expiresAt ? { expiresAt: grant.expiresAt } : {}),
      })),
    };
    return resolvedSnapshot;
  } catch (error) {
    if (error instanceof AdminUnavailableError || error instanceof RequestError) throw error;
    if (error instanceof InnerApiError && [3, 5, 7, 9].includes(error.code)) {
      throw new RequestError(error.message);
    }
    throw new AdminUnavailableError(`admin plugin resolution failed: ${String(error)}`);
  }
}

function toSnapshot(data: ModelProvider): ProviderSnapshot {
  return {
    id: data.id,
    userId: data.userId,
    name: data.name,
    model: data.model,
    providerKind: providerKind(data.providerKind),
    baseUrl: data.baseUrl,
    apiKey: data.apiKey,
    extraBody: data.extraBody ?? {},
    contextWindow: data.contextWindow,
    maxOutputTokens: data.maxOutputTokens,
    supportsImageInput: data.supportsImageInput,
    isDefault: data.isDefault,
    isEnabled: data.isEnabled,
  };
}

function providerKind(value: ProviderKind): string {
  return (
    (
      {
        [ProviderKind.PROVIDER_KIND_CHAT]: "chat",
        [ProviderKind.PROVIDER_KIND_IMAGE]: "image",
        [ProviderKind.PROVIDER_KIND_VIDEO]: "video",
        [ProviderKind.PROVIDER_KIND_EMBEDDING]: "embedding",
        [ProviderKind.PROVIDER_KIND_RERANK]: "rerank",
      } as Record<number, string>
    )[value] ?? ""
  );
}

function actor(userId: string, tenantId: string, workspaceId: string) {
  return { userId, tenantId, workspaceId };
}

async function assertSnapshotUrl(snapshot: ProviderSnapshot): Promise<ProviderSnapshot> {
  try {
    await assertPublicProviderUrl(snapshot.baseUrl);
  } catch (error) {
    throw new ProviderNotConfiguredError(`provider base URL is not allowed: ${String(error)}`);
  }
  return snapshot;
}

export async function getProvider(
  tenantId: string,
  workspaceId: string,
  providerId?: string | null,
): Promise<ProviderSnapshot & LanguageProviderSnapshot> {
  let data: ModelProvider | undefined;
  try {
    const client = adminClient();
    const response = providerId
      ? await client.caller.unary<{ provider?: ModelProvider }>(
          (metadata, options, callback) =>
            client.providers.getProvider(
              { actor: actor("", tenantId, workspaceId), providerId },
              metadata,
              options,
              callback,
            ),
          { headers: propagationHeaders() },
        )
      : await client.caller.unary<{ provider?: ModelProvider }>(
          (metadata, options, callback) =>
            client.providers.getDefaultProvider(
              { actor: actor("", tenantId, workspaceId) },
              metadata,
              options,
              callback,
            ),
          { headers: propagationHeaders() },
        );
    data = response.provider;
  } catch (err) {
    if (err instanceof InnerApiError && err.code === 5) {
      throw new ProviderNotConfiguredError("no model provider configured");
    }
    throw new AdminUnavailableError(`admin unreachable: ${String(err)}`);
  }
  if (!data) throw new AdminUnavailableError("admin returned no provider");
  const provider = await assertSnapshotUrl(toSnapshot(data));
  if (provider.providerKind !== "chat") {
    throw new ProviderNotConfiguredError(`provider ${provider.id} is not a configured language provider`);
  }
  return provider as ProviderSnapshot & LanguageProviderSnapshot;
}

export async function getProviderLimits(
  tenantId: string,
  workspaceId: string,
  providerId?: string | null,
): Promise<ProviderLimits> {
  const cache = getRedisClient();
  const key = providerLimitsKey(tenantId, workspaceId, providerId ?? null);
  const cached = await cache
    .get(key)
    .then(parseProviderLimits)
    .catch(() => null);
  if (cached) {
    return cached;
  }

  const provider = await getProvider(tenantId, workspaceId, providerId);
  const limits = {
    contextWindow: provider.contextWindow,
    maxOutputTokens: provider.maxOutputTokens,
  };
  await cache
    .set(key, JSON.stringify(limits), "EX", getServerSettings().providerCacheTtlSeconds)
    .catch(() => undefined);
  return limits;
}

export async function listProviderCatalog(tenantId: string, workspaceId: string): Promise<ProviderCatalogItem[]> {
  try {
    const client = adminClient();
    const response = await client.caller.unary<ListProviderCatalogResponse>(
      (metadata, options, callback) =>
        client.providers.listProviderCatalog({ actor: actor("", tenantId, workspaceId) }, metadata, options, callback),
      { headers: propagationHeaders() },
    );
    return response.providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      model: provider.model,
      providerKind: providerKind(provider.providerKind),
      isDefault: provider.isDefault,
      isEnabled: provider.isEnabled,
    }));
  } catch (err) {
    throw new AdminUnavailableError(`admin unreachable: ${String(err)}`);
  }
}

export async function getTaskProvider(
  tenantId: string,
  workspaceId: string,
  providerId: string,
): Promise<ProviderSnapshot> {
  try {
    const client = adminClient();
    const response = await client.caller.unary<{ provider?: ModelProvider }>(
      (metadata, options, callback) =>
        client.providers.getTaskProvider(
          { actor: actor("", tenantId, workspaceId), providerId },
          metadata,
          options,
          callback,
        ),
      { headers: propagationHeaders() },
    );
    if (!response.provider) throw new AdminUnavailableError("admin returned no task provider");
    return assertSnapshotUrl(toSnapshot(response.provider));
  } catch (err) {
    if (err instanceof InnerApiError && err.code === 5) {
      throw new ProviderNotConfiguredError(`provider ${providerId} not found`);
    }
    if (err instanceof AdminUnavailableError || err instanceof ProviderNotConfiguredError) throw err;
    throw new AdminUnavailableError(`admin unreachable: ${String(err)}`);
  }
}

export async function listSkills(tenantId: string, workspaceId: string): Promise<SkillSummary[]> {
  try {
    const client = adminClient();
    const response = await client.caller.unary<ListSkillsResponse>(
      (metadata, options, callback) =>
        client.configuration.listSkills({ actor: actor("", tenantId, workspaceId) }, metadata, options, callback),
      { headers: propagationHeaders() },
    );
    return response.skills.map((skill) => ({ id: skill.id, name: skill.name, description: skill.description }));
  } catch (err) {
    throw new AdminUnavailableError(`admin unreachable: ${String(err)}`);
  }
}

/** Pulls a skill's full L2 body on demand (progressive disclosure). Called by
 *  `load_skill` and by explicit `/` activation — never at prompt-assembly time. */
export async function getSkillBody(
  skillId: string,
  tenantId: string,
  workspaceId: string,
): Promise<{ id: string; name: string; body: string; files: string[] }> {
  let data;
  try {
    const client = adminClient();
    data = (
      await client.caller.unary<GetSkillResponse>(
        (metadata, options, callback) =>
          client.configuration.getSkill(
            { actor: actor("", tenantId, workspaceId), skillId },
            metadata,
            options,
            callback,
          ),
        { headers: propagationHeaders() },
      )
    ).skill;
  } catch (err) {
    if (err instanceof InnerApiError && err.code === 5) {
      throw new RequestError(`skill ${skillId} not found`);
    }
    throw new AdminUnavailableError(`admin unreachable: ${String(err)}`);
  }
  if (!data) throw new AdminUnavailableError("admin returned no skill");
  return { id: data.id, name: data.name, body: data.body, files: data.files };
}

export async function getSkillFile(
  skillId: string,
  tenantId: string,
  workspaceId: string,
  path: string,
): Promise<SkillFileResource> {
  try {
    const client = adminClient();
    const file = (
      await client.caller.unary<GetSkillFileResponse>(
        (metadata, options, callback) =>
          client.configuration.getSkillFile(
            { actor: actor("", tenantId, workspaceId), skillId, path },
            metadata,
            options,
            callback,
          ),
        { headers: propagationHeaders() },
      )
    ).file;
    if (!file) throw new AdminUnavailableError(`admin returned no skill file for ${path}`);
    if (file.storageKind === "inline" && typeof file.content === "string") {
      return { storageKind: "inline", mimeType: file.mimeType ?? null, content: file.content };
    }
    if (
      file.storageKind === "asset" &&
      file.assetId &&
      file.revisionId &&
      typeof file.sizeBytes === "number" &&
      file.sha256 &&
      file.url
    ) {
      return {
        storageKind: "asset",
        mimeType: file.mimeType ?? null,
        assetId: file.assetId,
        revisionId: file.revisionId,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        url: file.url,
      };
    }
    throw new AdminUnavailableError(`admin returned an invalid skill file descriptor for ${path}`);
  } catch (err) {
    if (err instanceof InnerApiError && err.code === 5) {
      throw new RequestError(`skill file ${path} not found`);
    }
    if (err instanceof AdminUnavailableError) {
      throw err;
    }
    throw new AdminUnavailableError(`admin unreachable: ${String(err)}`);
  }
}
