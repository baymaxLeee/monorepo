import { registerCapabilityProvider } from "../registry.js";
import type { CapabilityProvider } from "../types.js";

/**
 * Registers an MCP-backed capability without coupling the core agent to an MCP
 * transport. The provider owns client creation, auth, tool selection, and close.
 */
export function registerMcpCapability(
  provider: Omit<CapabilityProvider, "id"> & { id: string },
): () => void {
  return registerCapabilityProvider({ ...provider, id: `mcp:${provider.id}` });
}

