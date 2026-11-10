import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { InferToolSetContext } from "@ai-sdk/provider-utils";
import { addToolInputExamplesMiddleware, isStepCount, ToolLoopAgent, wrapLanguageModel, type ToolSet } from "ai";

const FINAL_REPORT_INSTRUCTION =
  "This is the final model step. Do not call tools. Return the complete self-contained report requested by the parent agent, including material findings, evidence URLs, uncertainty, and unresolved questions.";

function assertAutomaticTools(tools: ToolSet): void {
  for (const [name, definition] of Object.entries(tools)) {
    if (!("execute" in definition) || typeof definition.execute !== "function") {
      throw new Error(`inline subagent tool ${name} must execute automatically`);
    }
    const approval = (definition as { needsApproval?: unknown }).needsApproval;
    if (approval !== undefined && approval !== false) {
      throw new Error(`inline subagent tool ${name} cannot require approval`);
    }
  }
}

/**
 * Builds an isolated child agent. Callers can supply only an explicit prompt;
 * parent conversation messages and response lineage are intentionally absent.
 */
export function createInlineSubagent<const TOOLS extends ToolSet>({
  id,
  model,
  instructions,
  tools,
  toolsContext,
  maxOutputTokens,
  maxSteps = 20,
}: {
  id: string;
  model: LanguageModelV4;
  instructions: string;
  tools: TOOLS;
  toolsContext: InferToolSetContext<TOOLS>;
  maxOutputTokens?: number;
  maxSteps?: number;
}) {
  assertAutomaticTools(tools);
  if (!Number.isInteger(maxSteps) || maxSteps < 2) {
    throw new Error("inline subagent maxSteps must be an integer of at least 2");
  }
  const activeTools = Object.keys(tools) as Array<keyof TOOLS & string>;
  const agent = new ToolLoopAgent<never, TOOLS>({
    id,
    model: wrapLanguageModel({ model, middleware: addToolInputExamplesMiddleware() }),
    instructions,
    maxOutputTokens,
    timeout: { chunkMs: 120_000 },
    tools,
    // Generic ToolSet context requirements are conditional; callers still provide the inferred map above.
    // oxlint-disable-next-line typescript/no-unnecessary-type-assertion
    toolsContext: toolsContext as never,
    activeTools,
    toolOrder: [...activeTools].sort(),
    stopWhen: isStepCount(maxSteps),
    prepareStep: ({ steps }) =>
      steps.length === maxSteps - 1
        ? {
            activeTools: [],
            toolChoice: "none",
            instructions: `${instructions}\n\n${FINAL_REPORT_INSTRUCTION}`,
          }
        : undefined,
  });

  return {
    stream: ({ prompt, abortSignal }: { prompt: string; abortSignal?: AbortSignal }) =>
      agent.stream({ prompt, abortSignal }),
  };
}
