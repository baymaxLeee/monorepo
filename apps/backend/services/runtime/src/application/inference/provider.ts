import { createProviderModel, type LanguageProviderSnapshot } from "#runtime/provider-model";

import { contextCompactionThreshold } from "../agent/context/budget.js";
export function createInferenceModel(provider: LanguageProviderSnapshot) {
  return createProviderModel(provider, {
    parallelToolCalls: true,
    contextCompactionThreshold: contextCompactionThreshold(provider),
  });
}
