import { assembleInstructions } from "@repo/agent-runtime";

import type { AuthContext } from "../../api/http/middleware/auth.js";
import { getProvider } from "../../infrastructure/clients/admin.js";
import type { ReasoningEffort } from "../../infrastructure/provider/provider-model.js";
import { ForbiddenError } from "../errors.js";
import { reserveInference } from "./admission.js";
import type { RelayProvider } from "./policy.js";
import { createInferenceModel } from "./provider.js";

export async function resolveInferenceProvider(
  auth: AuthContext,
  providerId: string,
  reasoningEffort: ReasoningEffort,
): Promise<RelayProvider> {
  const provider = await getProvider(auth.tenantId, auth.workspaceId, providerId);
  if (!provider.isEnabled) throw new ForbiddenError("Model provider is disabled");
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
    model: createInferenceModel(provider, reasoningEffort),
  };
}
export const inferenceDependencies = { resolve: resolveInferenceProvider, reserve: reserveInference };
