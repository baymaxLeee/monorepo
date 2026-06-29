import { registerCapabilityProvider } from "../registry.js";
import type { CapabilityProvider } from "../types.js";

/**
 * Skills contribute scoped instructions and optional tools. Discovery and
 * storage remain outside the core agent; this adapter only joins the run scope.
 */
export function registerSkillCapability(
  provider: Omit<CapabilityProvider, "id"> & { id: string },
): () => void {
  return registerCapabilityProvider({ ...provider, id: `skill:${provider.id}` });
}

