import { AdminInternalClient } from "@backend/transport-ts";
import { createProviderModel } from "@backend/transport-ts/provider-model";
import { assertPublicProviderUrl } from "@backend/transport-ts/provider-url";
import { generateText } from "ai";
import { getWorkflowMetadata } from "workflow";
import { z } from "zod";

import { observeTaskCancellation } from "../src/application/tasks/cancellation.js";
import { getSettings } from "../src/bootstrap/config.js";

export const textGenerationInputSchema = z.object({
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  providerId: z.string().min(1),
  prompt: z.string().min(1),
});
type Input = z.infer<typeof textGenerationInputSchema>;

async function generateStep(input: Input) {
  "use step";
  const settings = getSettings();
  const client = new AdminInternalClient({
    baseUrl: settings.adminServiceUrl,
    internalToken: settings.internalApiToken,
    callerService: "executor",
  });
  const provider = await client.getProvider(input.providerId, input.tenantId, input.workspaceId);
  if (provider.provider_kind !== "chat") throw new Error("Text generation requires an inference provider");
  await assertPublicProviderUrl(provider.base_url);
  const { workflowRunId } = getWorkflowMetadata();
  const cancellation = observeTaskCancellation(workflowRunId);
  try {
    const result = await generateText({
      model: createProviderModel({
        id: provider.id,
        name: provider.name,
        contextWindow: provider.context_window,
        maxOutputTokens: provider.max_output_tokens,
        model: provider.model,
        baseUrl: provider.base_url,
        apiKey: provider.api_key,
        extraBody: provider.extra_body ?? {},
      }),
      prompt: input.prompt,
      maxOutputTokens: provider.max_output_tokens,
      maxRetries: 0,
      abortSignal: cancellation.signal,
    });
    cancellation.signal.throwIfAborted();
    if (!result.text.trim()) throw new Error("The provider returned no text");
    return { text: result.text };
  } finally {
    cancellation.dispose();
  }
}
// A paid model request must not be silently replayed after an ambiguous failure.
generateStep.maxRetries = 0;

export async function textGenerationWorkflow(input: Input) {
  "use workflow";
  return generateStep(input);
}
