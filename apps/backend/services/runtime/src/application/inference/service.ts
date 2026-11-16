import { assembleInstructions } from "@backend/agent-runtime-ts/instructions/index";

import type { AuthContext } from "../../api/http/middleware/auth.js";
import { getAgent, getProvider } from "../../infrastructure/clients/admin.js";
import { ForbiddenError } from "../errors.js";
import { reserveInference } from "./admission.js";
import type { RelayProvider } from "./policy.js";
import { createInferenceModel } from "./provider.js";

export async function resolveInferenceProvider(auth: AuthContext, agentId: string | null): Promise<RelayProvider> {
  const agent = agentId ? await getAgent(auth.userId, agentId, auth.tenantId, auth.workspaceId) : null;
  const provider = agent?.text ?? (await getProvider(auth.tenantId, auth.workspaceId));
  if (!provider.isEnabled) throw new ForbiddenError("Model provider is disabled");
  return {
    config: {
      agentId,
      agentName: agent?.agentName ?? "本地助手",
      model: provider.model,
      contextWindow: provider.contextWindow,
      maxOutputTokens: provider.maxOutputTokens,
      instructions: assembleInstructions({
        mode: "normal",
        storage: "local",
        memories: [],
        botProfile: agent?.profile,
      }),
    },
    model: createInferenceModel(provider),
  };
}
export const inferenceDependencies = { resolve: resolveInferenceProvider, reserve: reserveInference };
