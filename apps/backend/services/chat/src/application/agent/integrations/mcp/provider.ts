import type { AgentExtension } from "../types.js";

export function createMcpExtension(
  provider: Omit<AgentExtension, "id"> & { id: string },
): AgentExtension {
  return { ...provider, id: `mcp:${provider.id}` };
}
