import { type SubagentObserver, type PortableToolModel } from "@repo/agent-runtime";

import { finishSpan, startSpan } from "#runtime/foundation";
import type { LanguageProviderSnapshot } from "#runtime/provider-model";
import { createProviderModelBinding } from "#runtime/provider-model";

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
  const binding = createProviderModelBinding(provider, { parallelToolCalls: true });
  return {
    name: provider.model,
    model: binding.model,
    contextLimits: provider,
    contextSchema: subagentToolContextSchema,
    observer: runtimeSubagentObserver(),
  };
}
