import type { LanguageModelV4, LanguageModelV4Middleware } from "@ai-sdk/provider";
import type { StreamTextOnChunkCallback, ToolLoopAgentSettings, ToolSet } from "ai";

import type { ModelContextLimits } from "../context/budget.js";
import type { projectRuntimeContext } from "../context/history.js";
import type { RuntimeTokenUsage } from "../context/usage.js";
import type { ModelStreamRetryPolicy } from "./model-retry.js";

type SdkLoopSettings<C extends Record<string, unknown>> = ToolLoopAgentSettings<never, ToolSet, C>;

/** Host-provided immutable settings for one RuntimeTurn. The input queue and
 * SDK adapter remain kernel-owned and cannot be supplied by a host. */
export type RuntimeTurnSettings<C extends Record<string, unknown>> = Omit<
  SdkLoopSettings<C>,
  "model" | "prepareStep"
> & {
  model: LanguageModelV4;
  contextLimits?: ModelContextLimits;
  remoteCompactionBinding?: string;
  stepCheckpoint?: {
    assistantId: string;
    save: Awaited<ReturnType<typeof projectRuntimeContext>>["saveStepCheckpoint"];
  };
  onHistoryReplacement?: () => void;
  onCompactionUsage?: (usage: RuntimeTokenUsage) => void;
  compactionRetry?: ModelStreamRetryPolicy;
  middleware?: LanguageModelV4Middleware[];
  /** AI SDK current-step provider stream retries. Hosts must classify safe
   * retry boundaries before surfacing an error part to the loop. */
  streamRetries?: number;
  onChunk?: StreamTextOnChunkCallback<ToolSet>;
  prepareStep?: SdkLoopSettings<C>["prepareStep"];
};
