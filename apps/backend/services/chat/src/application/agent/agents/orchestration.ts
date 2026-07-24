import { isToolOutcome, toolOutcomeData } from "../tools/outcome.js";

const FINAL_RESPONSE_STEP_INDEX = 19;

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

export type ExecutionPlanReadState = {
  documentId: string | null;
  status: "not_required" | "pending" | "complete" | "failed";
  coveredThrough: number;
  totalLines: number;
};

export type OrchestrationSeed = {
  executionPlanDocumentId: string | null;
};

export type OrchestrationState = {
  skillLoadedThisRun: boolean;
  executionPlan: ExecutionPlanReadState;
};

export type OrchestrationDirective =
  | { kind: "final"; instruction: string }
  | { kind: "read-plan"; instruction: string }
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
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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
      if (
        typeof part.toolCallId !== "string" ||
        typeof part.toolName !== "string" ||
        seen.has(part.toolCallId)
      ) {
        return;
      }
      if (part.type === "tool-result") {
        if (part.preliminary === true) return;
        if (isToolOutcome(part.output) && part.output.status === "running") return;
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
            message:
              part.error instanceof Error
                ? part.error.message
                : `${part.toolName} failed during orchestration`,
          },
        });
      }
    });
  }
  return events.sort(
    (left, right) => left.stepNumber - right.stepNumber || left.order - right.order,
  );
}

function executionPlanReadState(
  documentId: string | null,
  events: readonly TerminalToolEvent[],
): ExecutionPlanReadState {
  if (!documentId) {
    return {
      documentId: null,
      status: "not_required",
      coveredThrough: 0,
      totalLines: 0,
    };
  }
  let coveredThrough = 0;
  let totalLines = 0;
  for (const event of events) {
    if (event.toolName !== "read_file") continue;
    const input = recordValue(event.input);
    if (input?.path !== documentId) continue;
    if (event.outcome.kind === "failed") {
      return {
        documentId,
        status: "failed",
        coveredThrough: 0,
        totalLines: 0,
      };
    }
    const data = recordValue(event.outcome.data);
    if (!data || data.path !== documentId) continue;
    const offset = typeof input.offset === "number" ? input.offset : 1;
    if (offset > coveredThrough + 1) continue;
    if (typeof data.total_lines === "number") totalLines = data.total_lines;
    if (typeof data.next_offset === "number") {
      coveredThrough = Math.max(coveredThrough, data.next_offset - 1);
    } else if (data.next_offset === null && totalLines > 0) {
      coveredThrough = totalLines;
    }
  }
  const complete = totalLines > 0 && coveredThrough >= totalLines;
  return {
    documentId,
    status: complete ? "complete" : "pending",
    coveredThrough,
    totalLines,
  };
}

export function deriveOrchestrationState(
  seed: OrchestrationSeed,
  steps: AgentStepHistory,
): OrchestrationState {
  const events = terminalToolEvents(steps);
  return {
    skillLoadedThisRun: events.some(
      (event) => event.toolName === "load_skill" && event.outcome.kind === "completed",
    ),
    executionPlan: executionPlanReadState(seed.executionPlanDocumentId, events),
  };
}

export function resolveOrchestrationDirective(
  state: OrchestrationState,
  completedStepCount: number,
): OrchestrationDirective {
  if (completedStepCount >= FINAL_RESPONSE_STEP_INDEX) {
    const hasIncompleteWork =
      state.executionPlan.status === "pending" ||
      state.executionPlan.status === "failed";
    return {
      kind: "final",
      instruction:
        (hasIncompleteWork
          ? "本轮已保留已生成的产物，但选定的 Plan 尚未完整读取。请根据上方工具卡片中的结果继续处理。"
          : "本轮处理已完成。"),
    };
  }
  if (state.executionPlan.status === "failed") {
    return {
      kind: "final",
      instruction:
        "无法完整读取选定的 Plan，因此本轮没有开始执行。请检查 Plan 后重试。",
    };
  }
  if (state.executionPlan.status === "pending") {
    return {
      kind: "read-plan",
      instruction: `Read the selected Plan document ${state.executionPlan.documentId} from offset ${state.executionPlan.coveredThrough + 1} before executing it.`,
    };
  }
  return { kind: "default" };
}
