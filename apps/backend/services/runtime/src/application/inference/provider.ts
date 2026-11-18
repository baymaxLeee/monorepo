import {
  createProviderModel,
  type LanguageProviderSnapshot,
  type ReasoningEffort,
} from "#runtime/provider-model";

export function createInferenceModel(provider: LanguageProviderSnapshot, reasoningEffort?: ReasoningEffort) {
  return createProviderModel(provider, {
    parallelToolCalls: true,
    reasoningEffort,
  });
}
