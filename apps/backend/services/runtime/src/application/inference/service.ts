import { assembleInstructions } from "@repo/agent-runtime";

import type { ReasoningEffort } from "../../infrastructure/provider/provider-model.js";
import type { RuntimeProviderCapability } from "../agent/runtime/types.js";
import { ForbiddenError } from "../errors.js";
import type { RelayProvider } from "./policy.js";
import { createInferenceModel } from "./provider.js";

export async function resolveInferenceProvider(
  provider: RuntimeProviderCapability,
  reasoningEffort: ReasoningEffort,
): Promise<RelayProvider> {
  if ((provider.providerKind ?? "chat") !== "chat") throw new ForbiddenError("Model provider is not a chat provider");
  return {
    config: {
      providerId: provider.id,
      providerName: provider.name,
      reasoningEffort,
      model: provider.model,
      contextWindow: provider.contextWindow,
      maxOutputTokens: provider.maxOutputTokens,
      instructions: assembleInstructions({ memories: [] }),
    },
    model: createInferenceModel(provider, reasoningEffort, "stateless").model,
  };
}
