import { createProviderModel, type LanguageProviderSnapshot } from "#runtime/provider-model";

export function createInferenceModel(provider: LanguageProviderSnapshot) {
  return createProviderModel(provider, {
    parallelToolCalls: true,
  });
}
