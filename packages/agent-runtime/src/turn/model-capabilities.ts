import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import type { ModelMessage } from "ai";

export interface ModelStepResult {
  providerMetadata?: unknown;
  response: { id?: string };
}

/** Provider-owned stored-response semantics. The runtime kernel keeps the
 * continuation token opaque and delegates every wire-level transformation. */
export interface StoredModelContinuation {
  prepareStatelessCall(params: LanguageModelV4CallOptions): LanguageModelV4CallOptions;
  prepareCall(params: LanguageModelV4CallOptions, previousResponseId: string): LanguageModelV4CallOptions | null;
  prepareStep(
    messages: ModelMessage[],
    previousResponseId: string,
  ): { messages: ModelMessage[]; providerOptions?: LanguageModelV4CallOptions["providerOptions"] };
  responseId(event: ModelStepResult): string | null;
}
