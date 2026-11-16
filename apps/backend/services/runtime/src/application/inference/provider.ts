import { createProviderModel, type LanguageProviderSnapshot } from "@backend/transport-ts/provider-model";

import { contextCompactionThreshold } from "../agent/context/budget.js";
export function createInferenceModel(provider: LanguageProviderSnapshot) {
  return createProviderModel(provider, {
    parallelToolCalls: true,
    contextCompactionThreshold: contextCompactionThreshold(provider),
  });
}
