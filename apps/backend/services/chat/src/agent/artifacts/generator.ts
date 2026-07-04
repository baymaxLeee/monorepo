import { createProviderModel, type ChatProvider } from "@backend/transport-ts/provider-model";
import { ARTIFACT_GENERATION_TIMEOUT } from "./config.js";

export function buildArtifactTextModel(provider: ChatProvider) {
  const model = createProviderModel(provider, { disableReasoning: true });
  return {
    model,
    maxOutputTokens: provider.maxOutputTokens,
  };
}

export async function collectText(result: { textStream: AsyncIterable<string> }): Promise<string> {
  let raw = "";
  for await (const delta of result.textStream) raw += delta;
  return raw;
}

export function combinedSignal(abortSignal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(ARTIFACT_GENERATION_TIMEOUT.totalMs);
  return abortSignal ? AbortSignal.any([abortSignal, timeout]) : timeout;
}
