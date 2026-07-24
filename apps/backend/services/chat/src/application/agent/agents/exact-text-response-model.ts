import { randomBytes } from "node:crypto";

import type { LanguageModelV4, LanguageModelV4Usage } from "@ai-sdk/provider";

const ZERO_USAGE: LanguageModelV4Usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

export function exactTextResponseModel(baseModel: LanguageModelV4, response: string): LanguageModelV4 {
  return {
    specificationVersion: "v4",
    provider: baseModel.provider,
    modelId: baseModel.modelId,
    supportedUrls: baseModel.supportedUrls,
    doGenerate: async () => ({
      content: [{ type: "text", text: response }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: ZERO_USAGE,
      warnings: [],
    }),
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          const id = `exact-response-${randomBytes(12).toString("hex")}`;
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id });
          controller.enqueue({ type: "text-delta", id, delta: response });
          controller.enqueue({ type: "text-end", id });
          controller.enqueue({
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: ZERO_USAGE,
          });
          controller.close();
        },
      }),
    }),
  };
}
