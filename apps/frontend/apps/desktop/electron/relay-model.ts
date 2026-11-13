import { randomUUID } from "node:crypto";

import type { LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";

import { inferenceRequestSchema, type InferenceConfig, type InferenceRequest } from "../contracts/inference.generated";

export type RelayCall = (
  request: InferenceRequest,
  signal?: AbortSignal,
) => Promise<ReadableStream<LanguageModelV4StreamPart>>;
function transportOptions(options: LanguageModelV4CallOptions) {
  const { prompt, tools, toolChoice, temperature, topP, reasoning, maxOutputTokens } = options;
  // SDK provider metadata can contain response identifiers. The local journal
  // supplies the complete context; do not turn a local thread into remote state.
  return JSON.parse(
    JSON.stringify({ prompt, tools, toolChoice, temperature, topP, reasoning, maxOutputTokens }, (key, value) => {
      if (key === "providerOptions") return undefined;
      if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
      return value;
    }),
  );
}
export function relayModel(config: InferenceConfig, call: RelayCall): LanguageModelV4 {
  return {
    specificationVersion: "v4",
    provider: "platform-inference-relay",
    modelId: config.model,
    supportedUrls: {},
    doGenerate: () => {
      throw new Error("本地模型使用流式推理");
    },
    async doStream(options) {
      const request = inferenceRequestSchema.parse({
        requestId: randomUUID(),
        agentId: config.agentId,
        model: config.model,
        options: transportOptions({ ...options, maxOutputTokens: options.maxOutputTokens ?? config.maxOutputTokens }),
      });
      return { stream: await call(request, options.abortSignal) };
    },
  };
}
