import { defaultToolCatalog } from "../../tools/catalog.js";
import type { AgentExtension } from "../types.js";

/**
 * Registers MCP-backed tools without coupling the core agent to an MCP
 * transport. The provider owns client creation, auth, tool selection, and close.
 */
export function registerMcpTools(
  provider: Omit<AgentExtension, "id"> & { id: string },
): () => void {
  return defaultToolCatalog.register({ ...provider, id: `mcp:${provider.id}` });
}
