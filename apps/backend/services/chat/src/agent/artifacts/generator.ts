// Markdown-only now. HTML planning/block-generation moved to the executor
// service (apps/backend/services/executor/src/artifacts/generator.ts) as
// part of the agent_task_执行时服务 plan Phase 2.
import { createProviderModel, type ChatProvider } from "@backend/transport-ts/provider-model";
import { ARTIFACT_GENERATION_TIMEOUT } from "./config.js";

// Takes the already-resolved text provider snapshot (passed from the run entry)
// — never fetches. The chat model provider and the artifact text model are the
// same agent "text" provider.
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
