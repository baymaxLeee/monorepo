import type { LanguageModelV4, LanguageModelV4Middleware } from "@ai-sdk/provider";
import type { ToolLoopAgentSettings, ToolSet } from "ai";

/** User-selectable approval policy. Host-only `policy` remains an environment fact. */
export type ApprovalMode = "request" | "auto" | "full";

type SdkLoopSettings<C extends Record<string, unknown>> = ToolLoopAgentSettings<never, ToolSet, C>;

/** Host-provided immutable settings for one RuntimeTurn. The input queue and
 * SDK adapter remain kernel-owned and cannot be supplied by a host. */
export type RuntimeTurnSettings<C extends Record<string, unknown>> = Omit<
  SdkLoopSettings<C>,
  "model" | "prepareStep"
> & {
  model: LanguageModelV4;
  middleware?: LanguageModelV4Middleware[];
  prepareStep?: SdkLoopSettings<C>["prepareStep"];
};
