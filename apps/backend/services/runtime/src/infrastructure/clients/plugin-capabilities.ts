import { createHmac } from "node:crypto";

import type { ResolvedTurnPluginSnapshot } from "@repo/agent-runtime";

import { CapabilityBindingError, RequestError } from "../../application/errors.js";
import type { getServerSettings } from "../../config/server.js";

type PlatformPluginCredentialSettings = Pick<
  ReturnType<typeof getServerSettings>,
  "internalApiToken" | "knowledgeServiceUrl" | "canvasServiceUrl"
>;

const firstPartyMcpResources = {
  "knowledge@platform": { serverName: "knowledge", serviceUrl: "knowledgeServiceUrl" },
  "canvas@platform": { serverName: "canvas", serviceUrl: "canvasServiceUrl" },
} as const;

const businessIdentityHeaders = new Set(["x-project-id", "x-canvas-id"]);

function isBusinessIdentityHeader(header: string): boolean {
  const normalized = header.toLowerCase();
  return normalized.startsWith("x-auth-") || businessIdentityHeaders.has(normalized);
}

function assertTenantNeutralHeaders(headers: Readonly<Record<string, string>>): void {
  if (Object.keys(headers).some(isBusinessIdentityHeader)) {
    throw new CapabilityBindingError("plugin capability contains a business identity header");
  }
}

interface TurnFence {
  runId: string;
  attemptEpoch: number | bigint;
}

/** Adds Runtime's workload credential only to fixed first-party MCP endpoints. */
export function attachPlatformMcpCredential(
  snapshot: ResolvedTurnPluginSnapshot,
  settings: PlatformPluginCredentialSettings,
): ResolvedTurnPluginSnapshot {
  const platformGrantKeys = new Set<string>();
  for (const resolved of snapshot.plugins) {
    const resource = firstPartyMcpResources[resolved.manifest.id as keyof typeof firstPartyMcpResources];
    if (!resource) continue;
    if (resolved.manifest.source !== "system" || resolved.manifest.trust !== "system") {
      throw new CapabilityBindingError(`${resolved.manifest.id} is not a trusted system release`);
    }
    const servers = resolved.manifest.mcpServers.filter((server) => server.name === resource.serverName);
    const expectedUrl = new URL("/mcp", settings[resource.serviceUrl]).toString();
    if (
      resolved.manifest.mcpServers.length !== 1 ||
      servers.length !== 1 ||
      new URL(servers[0].url).toString() !== expectedUrl
    ) {
      throw new CapabilityBindingError(`${resolved.manifest.id} does not target its configured platform MCP endpoint`);
    }
    platformGrantKeys.add(`${resolved.manifest.id}\u0000${resource.serverName}`);
  }
  return {
    ...snapshot,
    connectionGrants: snapshot.connectionGrants.map((grant) => {
      assertTenantNeutralHeaders(grant.headers);
      if (
        Object.keys(grant.headers).some((header) =>
          [
            "x-internal-token",
            "x-runtime-turn-id",
            "x-runtime-attempt-epoch",
            "x-mcp-app-call-id",
            "x-runtime-scope-credential",
          ].includes(header.toLowerCase()),
        )
      ) {
        throw new CapabilityBindingError("upper host returned a reserved workload credential header");
      }
      const key = `${grant.pluginId}\u0000${grant.serverName}`;
      return platformGrantKeys.has(key)
        ? {
            ...grant,
            headers: {
              ...grant.headers,
              "X-Internal-Token": settings.internalApiToken,
              "X-Caller-Service": "runtime",
            },
          }
        : { ...grant, headers: { ...grant.headers } };
    }),
  };
}

// The resource owner can verify both the encrypted scope and the exact kind of execution.
function executionHeaders(
  grant: ResolvedTurnPluginSnapshot["connectionGrants"][number],
  kind: "turn" | "app",
  id: string,
  epoch: string,
) {
  const headers = {
    ...grant.headers,
    ...(kind === "turn" ? { "X-Runtime-Turn-ID": id, "X-Runtime-Attempt-Epoch": epoch } : { "X-MCP-App-Call-ID": id }),
  };
  const token = grant.headers["X-Internal-Token"];
  if (!token) return headers;
  const scope = grant.headers["X-MCP-Resource-Grant"];
  if (!scope) throw new CapabilityBindingError("missing platform resource grant");
  const proof = createHmac("sha256", token)
    .update(["v2", grant.serverName, kind, id, epoch, scope].join("\n"))
    .digest("base64url");
  return { ...headers, "X-Runtime-Scope-Credential": "v2." + proof };
}

export function bindAppReadGrants(snapshot: ResolvedTurnPluginSnapshot, requestId: string): ResolvedTurnPluginSnapshot {
  return {
    ...snapshot,
    connectionGrants: snapshot.connectionGrants.map((grant) => ({
      ...grant,
      headers: executionHeaders(grant, "app", requestId, ""),
    })),
  };
}

/** Fences every live grant to the exact Runtime attempt without adding product identity. */
export function bindTurnPluginGrants(
  snapshot: ResolvedTurnPluginSnapshot,
  token: TurnFence,
): ResolvedTurnPluginSnapshot {
  const validEpoch =
    typeof token.attemptEpoch === "bigint"
      ? token.attemptEpoch >= 1n
      : Number.isSafeInteger(token.attemptEpoch) && token.attemptEpoch >= 1;
  if (!token.runId || !validEpoch) {
    throw new CapabilityBindingError("invalid Runtime Turn fence");
  }
  return {
    ...snapshot,
    connectionGrants: snapshot.connectionGrants.map((grant) => {
      assertTenantNeutralHeaders(grant.headers);
      return {
        ...grant,
        headers: executionHeaders(grant, "turn", token.runId, String(token.attemptEpoch)),
      };
    }),
  };
}

/** Desktop is outside the service trust domain and cannot receive platform workload credentials. */
export function assertLocalPluginExecutionAllowed(snapshot: ResolvedTurnPluginSnapshot): ResolvedTurnPluginSnapshot {
  const systemPlugin = snapshot.plugins.find(
    ({ manifest }) => manifest.source === "system" || manifest.trust === "system",
  );
  if (systemPlugin) {
    throw new RequestError(`${systemPlugin.manifest.id} requires cloud Runtime execution`);
  }
  snapshot.connectionGrants.forEach((grant) => assertTenantNeutralHeaders(grant.headers));
  return snapshot;
}
