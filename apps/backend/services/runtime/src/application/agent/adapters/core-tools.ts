import { finishSpan, startSpan } from "@backend/kernel-ts";
import type { LanguageProviderSnapshot } from "@backend/transport-ts/provider-model";
import { createProviderModel } from "@backend/transport-ts/provider-model";
import type { PortableToolModel } from "@repo/agent-runtime/tools/registry";
import type { SubagentObserver } from "@repo/agent-runtime/tools/subagents";

import { contextCompactionThreshold } from "../context/budget.js";
import { subagentToolContextSchema, type SubagentToolContext } from "../tools/context.js";

function runtimeSubagentObserver(): SubagentObserver<SubagentToolContext> {
  return {
    start: ({ context, toolCallId, taskId, model }) => {
      const span = startSpan("agent.subagent", {
        "agent.run_id": context.runId,
        "agent.parent_tool_call_id": toolCallId,
        "agent.subagent_id": taskId,
        "gen_ai.request.model": model,
      });
      return {
        finish: ({ steps, toolCalls, usage, error }) =>
          finishSpan(
            span,
            {
              ...(steps !== undefined ? { "agent.subagent_steps": steps } : {}),
              ...(toolCalls !== undefined ? { "agent.subagent_tool_call_count": toolCalls } : {}),
              ...(usage?.inputTokens != null ? { "gen_ai.usage.input_tokens": usage.inputTokens } : {}),
              ...(usage?.outputTokens != null ? { "gen_ai.usage.output_tokens": usage.outputTokens } : {}),
              ...(usage?.totalTokens != null ? { "gen_ai.usage.total_tokens": usage.totalTokens } : {}),
            },
            error,
          ),
      };
    },
  };
}

export function createRuntimePortableToolModel(
  provider: LanguageProviderSnapshot,
): PortableToolModel<SubagentToolContext> {
  return {
    name: provider.model,
    model: createProviderModel(provider, {
      parallelToolCalls: true,
      contextCompactionThreshold: contextCompactionThreshold(provider),
    }),
    maxOutputTokens: provider.maxOutputTokens,
    supportsStoredContinuation: provider.responsesDialect !== "deepseek_responses",
    contextSchema: subagentToolContextSchema,
    observer: runtimeSubagentObserver(),
  };
}
