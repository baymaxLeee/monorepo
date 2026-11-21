import { randomUUID } from "node:crypto";

import type { LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";

import {
  inferenceRequestSchema,
  inferenceRelayErrorSchema,
  type InferenceConfig,
  type InferenceRequest,
} from "../../contracts/inference.generated";

export type RelayCall = (
  request: InferenceRequest,
  signal?: AbortSignal,
) => Promise<ReadableStream<LanguageModelV4StreamPart>>;

export class RetryableModelConnectionError extends Error {
  readonly code = "model_connection_failed";
  readonly retryable = true;

  constructor() {
    super("网络连接仍不可用，已重试 3 次，请稍后重试");
    this.name = "RetryableModelConnectionError";
  }
}

export function isRetryableModelConnectionError(error: unknown): error is RetryableModelConnectionError {
  return error instanceof RetryableModelConnectionError;
}

function normalizedRelayStream(stream: ReadableStream<LanguageModelV4StreamPart>) {
  return stream.pipeThrough(
    new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
      transform(part, controller) {
        if (part.type !== "error") {
          controller.enqueue(part);
          return;
        }
        const parsed = inferenceRelayErrorSchema.safeParse(part.error);
        if (parsed.success && parsed.data.retryable) {
          controller.enqueue({ type: "error", error: new RetryableModelConnectionError() });
          return;
        }
        controller.error(new Error(parsed.success ? parsed.data.message : "模型请求失败，请稍后重试"));
      },
    }),
  );
}
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
        providerId: config.providerId,
        reasoningEffort: config.reasoningEffort,
        model: config.model,
        options: transportOptions({ ...options, maxOutputTokens: options.maxOutputTokens ?? config.maxOutputTokens }),
      });
      return { stream: normalizedRelayStream(await call(request, options.abortSignal)) };
    },
  };
}
