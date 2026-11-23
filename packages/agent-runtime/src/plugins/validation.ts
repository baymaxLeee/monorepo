import type {
  AgentPluginManifest,
  McpServerContribution,
  PluginActivation,
  ResolvedTurnPluginSnapshot,
} from "./types.js";

const COMPONENT_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const SERVER_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const BINDING_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function assertPluginId(id: string): void {
  const separator = id.lastIndexOf("@");
  const parts = separator > 0 ? [id.slice(0, separator), id.slice(separator + 1)] : [];
  if (
    parts.length !== 2 ||
    parts.some((part) => !COMPONENT_PATTERN.test(part) || part.includes("--") || part.includes(".."))
  ) {
    throw new Error(`invalid agent plugin id ${JSON.stringify(id)}; expected lowercase name@marketplace`);
  }
}

function unique(values: readonly string[], kind: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`agent plugin manifest contains duplicate ${kind}`);
  }
}

function validateBindings(server: McpServerContribution, activation: PluginActivation): void {
  const bindings = activation.bindings ?? {};
  const required = new Set(server.requiredBindings ?? []);
  const optional = new Set(server.optionalBindings ?? []);
  const allowed = new Set([...required, ...optional]);
  unique([...allowed], "binding keys");
  for (const key of allowed) {
    if (!BINDING_KEY_PATTERN.test(key)) {
      throw new Error(`agent plugin ${activation.pluginId} has invalid binding key ${key}`);
    }
  }
  for (const key of required) {
    if (!bindings[key]) {
      throw new Error(`agent plugin ${activation.pluginId} requires binding ${key}`);
    }
  }
  for (const [key, value] of Object.entries(bindings)) {
    if (!allowed.has(key)) {
      throw new Error(`agent plugin ${activation.pluginId} does not allow binding ${key}`);
    }
    if (!value || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) {
      throw new Error(`agent plugin ${activation.pluginId} binding ${key} is invalid`);
    }
  }
}

function validateManifest(manifest: AgentPluginManifest, activation: PluginActivation): void {
  assertPluginId(manifest.id);
  if (activation.pluginId !== manifest.id) {
    throw new Error(`resolved plugin identity mismatch: selected ${activation.pluginId}, received ${manifest.id}`);
  }
  if (manifest.schemaVersion !== 1 || !manifest.version || !DIGEST_PATTERN.test(manifest.digest)) {
    throw new Error(`agent plugin ${manifest.id} has an invalid immutable release identity`);
  }
  if (!manifest.displayName.trim() || !manifest.description.trim()) {
    throw new Error(`agent plugin ${manifest.id} has incomplete display metadata`);
  }
  if (manifest.source !== "system" && manifest.trust === "system") {
    throw new Error(`external agent plugin ${manifest.id} cannot claim system trust`);
  }
  unique(
    (manifest.skills ?? []).map((skill) => skill.id),
    "skill identities",
  );
  unique(
    (manifest.skills ?? []).map((skill) => skill.name),
    "skill names",
  );
  for (const skill of manifest.skills ?? []) {
    if (
      !skill.id ||
      !skill.name.trim() ||
      skill.name.length > 64 ||
      !skill.description.trim() ||
      !skill.assetId ||
      !skill.revisionId ||
      !SHA256_PATTERN.test(skill.sha256)
    ) {
      throw new Error(`agent plugin ${manifest.id} has an invalid skill contribution`);
    }
  }
  unique(
    manifest.mcpServers.map((server) => server.name),
    "MCP server names",
  );
  for (const server of manifest.mcpServers) {
    if (!SERVER_NAME_PATTERN.test(server.name) || server.tools.length === 0) {
      throw new Error(`agent plugin ${manifest.id} has an invalid MCP server manifest`);
    }
    const endpoint = new URL(server.url);
    if (
      !["http:", "https:"].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    ) {
      throw new Error(`agent plugin ${manifest.id} MCP server ${server.name} must use a fixed HTTP endpoint`);
    }
    unique(
      server.tools.map((tool) => tool.name),
      "MCP tool names",
    );
    for (const tool of server.tools) {
      if (!tool.name || !tool.description.trim()) {
        throw new Error(`agent plugin ${manifest.id} has incomplete MCP tool metadata`);
      }
      if (manifest.trust !== "system" && tool.policy.trust === "closed") {
        throw new Error(`agent plugin ${manifest.id} cannot publish a closed-trust tool`);
      }
      if (
        tool.policy.callableByCodeMode &&
        (tool.policy.effect !== "read" || tool.policy.execution !== "inline" || tool.policy.trust !== "open-world")
      ) {
        throw new Error(`agent plugin ${manifest.id} Code Mode tool ${tool.name} has an unsafe policy`);
      }
      const rawPolicy = tool.policy as Record<string, unknown>;
      if (rawPolicy.source !== undefined || rawPolicy.pluginId !== undefined) {
        throw new Error(`agent plugin ${manifest.id} tool policy contains runtime-owned fields`);
      }
    }
    validateBindings(server, activation);
  }
}

export function validateResolvedSnapshot(snapshot: ResolvedTurnPluginSnapshot): void {
  if (snapshot.schemaVersion !== 1 || !snapshot.snapshotId || !DIGEST_PATTERN.test(snapshot.snapshotDigest)) {
    throw new Error("resolved plugin snapshot has an invalid identity");
  }
  const pluginIds = snapshot.plugins.map((plugin) => plugin.manifest.id);
  unique(pluginIds, "plugin identities");
  const serverOwners = new Map<string, string>();
  for (const resolved of snapshot.plugins) {
    validateManifest(resolved.manifest, resolved.activation);
    for (const server of resolved.manifest.mcpServers) {
      const owner = serverOwners.get(server.name);
      if (owner) {
        throw new Error(`MCP server ${server.name} is contributed by both ${owner} and ${resolved.manifest.id}`);
      }
      serverOwners.set(server.name, resolved.manifest.id);
    }
  }
  unique(
    snapshot.connectionGrants.map((grant) => `${grant.pluginId}\u0000${grant.serverName}`),
    "MCP connection grants",
  );
  const selected = new Set(pluginIds);
  for (const grant of snapshot.connectionGrants) {
    if (!selected.has(grant.pluginId)) {
      throw new Error(`connection grant references inactive plugin ${grant.pluginId}`);
    }
    if (serverOwners.get(grant.serverName) !== grant.pluginId) {
      throw new Error(`connection grant references undeclared MCP server ${grant.pluginId}/${grant.serverName}`);
    }
    if (
      Object.entries(grant.headers).some(
        ([name, value]) => !name || !value || /[\r\n\u0000]/u.test(name) || /[\r\n\u0000]/u.test(value),
      )
    ) {
      throw new Error(`connection grant for ${grant.pluginId}/${grant.serverName} is invalid`);
    }
  }
}
