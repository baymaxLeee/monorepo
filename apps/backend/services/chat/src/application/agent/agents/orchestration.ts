import { isToolOutcome, toolOutcomeData } from "../tools/outcome.js";

export const MAX_AGENT_STEPS = 50;
const FINAL_RESPONSE_STEP_INDEX = MAX_AGENT_STEPS - 1;

type AgentStepPart = {
  type?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  input?: unknown;
  output?: unknown;
  error?: unknown;
  preliminary?: unknown;
};

export type AgentStepHistory = ReadonlyArray<{
  stepNumber: number;
  content: ReadonlyArray<AgentStepPart>;
}>;

export type OrchestrationState = {
  skillLoadedThisRun: boolean;
};

export type OrchestrationDirective =
  | { kind: "final"; instruction: string }
  | { kind: "final-summary"; instruction: string }
  | { kind: "default" };

type TerminalToolEvent = {
  stepNumber: number;
  order: number;
  toolCallId: string;
  toolName: string;
  input?: unknown;
  outcome: { kind: "completed"; data: unknown } | { kind: "failed"; message: string };
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function terminalToolEvents(steps: AgentStepHistory): TerminalToolEvent[] {
  const events: TerminalToolEvent[] = [];
  const seen = new Set<string>();
  for (const step of [...steps].sort((left, right) => left.stepNumber - right.stepNumber)) {
    const callOrder = new Map<string, number>();
    step.content.forEach((part, order) => {
      if (part.type === "tool-call" && typeof part.toolCallId === "string") {
        callOrder.set(part.toolCallId, order);
      }
    });
    step.content.forEach((part, order) => {
      if (typeof part.toolCallId !== "string" || typeof part.toolName !== "string" || seen.has(part.toolCallId)) {
        return;
      }
      if (part.type === "tool-result") {
        if (part.preliminary === true) {
          return;
        }
        if (isToolOutcome(part.output) && part.output.status === "running") {
          return;
        }
        seen.add(part.toolCallId);
        if (isToolOutcome(part.output) && part.output.status === "completed") {
          events.push({
            stepNumber: step.stepNumber,
            order: callOrder.get(part.toolCallId) ?? order,
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: part.input,
            outcome: { kind: "completed", data: toolOutcomeData(part.output) },
          });
          return;
        }
        events.push({
          stepNumber: step.stepNumber,
          order: callOrder.get(part.toolCallId) ?? order,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input,
          outcome: {
            kind: "failed",
            message:
              isToolOutcome(part.output) && part.output.ok === false
                ? part.output.error.message
                : `${part.toolName} returned an invalid terminal outcome`,
          },
        });
        return;
      }
      if (part.type === "tool-error") {
        seen.add(part.toolCallId);
        events.push({
          stepNumber: step.stepNumber,
          order: callOrder.get(part.toolCallId) ?? order,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input,
          outcome: {
            kind: "failed",
            message: part.error instanceof Error ? part.error.message : `${part.toolName} failed during orchestration`,
          },
        });
      }
    });
  }
  return events.sort((left, right) => left.stepNumber - right.stepNumber || left.order - right.order);
}

export function deriveOrchestrationState(steps: AgentStepHistory): OrchestrationState {
  const events = terminalToolEvents(steps);
  return {
    skillLoadedThisRun: events.some((event) => event.toolName === "load_skill" && event.outcome.kind === "completed"),
  };
}

export function resolveOrchestrationDirective(
  state: OrchestrationState,
  completedStepCount: number,
): OrchestrationDirective {
  if (completedStepCount >= FINAL_RESPONSE_STEP_INDEX) {
    return {
      kind: "final-summary",
      instruction:
        "This is the final response step. Do not call tools. Report only outcomes proven by observed terminal tool results. A requested file or artifact is complete only when its publication tool completed; if it was only created in Bash or publication did not complete, state that it remains incomplete and name the remaining action. Never use a generic completion claim.",
    };
  }
  return { kind: "default" };
}
