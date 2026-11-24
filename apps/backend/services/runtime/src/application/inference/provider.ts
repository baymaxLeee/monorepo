import {
  createProviderModelBinding,
  type LanguageProviderSnapshot,
  type ReasoningEffort,
} from "#runtime/provider-model";

export function createInferenceModel(
  provider: LanguageProviderSnapshot,
  reasoningEffort?: ReasoningEffort,
  mode: "stored" | "stateless" = "stored",
) {
  return createProviderModelBinding(provider, {
    parallelToolCalls: true,
    reasoningEffort,
    store: mode === "stored",
  });
}
