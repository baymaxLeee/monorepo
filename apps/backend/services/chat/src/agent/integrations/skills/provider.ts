import { defaultToolCatalog } from "../../tools/catalog.js";
import type { AgentExtension } from "../types.js";

/**
 * Skills contribute scoped instructions and optional tools. Discovery and
 * storage remain outside the core agent; this adapter only joins the run scope.
 */
export function registerSkillTools(
  provider: Omit<AgentExtension, "id"> & { id: string },
): () => void {
  return defaultToolCatalog.register({ ...provider, id: `skill:${provider.id}` });
}
