import {
  artifactVerificationDirective,
  createArtifactVerificationState,
  markArtifactVerificationBudgetExhausted,
  reduceArtifactVerificationEvents,
  type ArtifactVerificationDirective,
  type ArtifactVerificationEvent,
  type ArtifactVerificationState,
} from "../../../domain/agent/artifact-verification.js";
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
  totalChars: number;
};

export type OrchestrationSeed = {
  executionPlanDocumentId: string | null;
};

export type OrchestrationState = {
  skillLoadedThisRun: boolean;
  executionPlan: ExecutionPlanReadState;
  artifactVerification: ArtifactVerificationState;
};

export type ExactToolDirective = Extract<
  ArtifactVerificationDirective,
  { toolName: "validate_html" | "edit_file" }
>;

export type OrchestrationDirective =
  | { kind: "final"; instruction: string }
  | { kind: "read-plan"; instruction: string }
  | { kind: "exact-tools"; directive: ExactToolDirective }
  | { kind: "default" };

type TerminalToolEvent = ArtifactVerificationEvent & { stepNumber: number; order: number };

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
      totalChars: 0,
    };
  }
  const slices: Array<{ offset: number; end: number; total: number }> = [];
  for (const event of events) {
    if (event.toolName !== "read_file") continue;
    const input = recordValue(event.input);
    if (input?.file_id !== documentId) continue;
    if (event.outcome.kind === "failed") {
      return {
        documentId,
        status: "failed",
        coveredThrough: 0,
        totalChars: 0,
      };
    }
    const data = recordValue(event.outcome.data);
    if (!data || data.file_id !== documentId) continue;
    if (
      typeof data.offset === "number" &&
      typeof data.total_chars === "number" &&
      typeof data.content === "string"
    ) {
      slices.push({
        offset: data.offset,
        end: data.offset + data.content.length,
        total: data.total_chars,
      });
    }
  }
  slices.sort((left, right) => left.offset - right.offset);
  let coveredThrough = 0;
  let totalChars = 0;
  for (const slice of slices) {
    totalChars = Math.max(totalChars, slice.total);
    if (slice.offset > coveredThrough) break;
    coveredThrough = Math.max(coveredThrough, slice.end);
  }
  return {
    documentId,
    status: totalChars > 0 && coveredThrough >= totalChars ? "complete" : "pending",
    coveredThrough,
    totalChars,
  };
}

export function deriveOrchestrationState(
  seed: OrchestrationSeed,
  steps: AgentStepHistory,
): OrchestrationState {
  const events = terminalToolEvents(steps);
  const artifactVerification = reduceArtifactVerificationEvents(
    createArtifactVerificationState(),
    events,
  );
  return {
    skillLoadedThisRun: events.some(
      (event) => event.toolName === "load_skill" && event.outcome.kind === "completed",
    ),
    executionPlan: executionPlanReadState(seed.executionPlanDocumentId, events),
    artifactVerification:
      steps.length >= FINAL_RESPONSE_STEP_INDEX
        ? markArtifactVerificationBudgetExhausted(artifactVerification)
        : artifactVerification,
  };
}

export function resolveOrchestrationDirective(
  state: OrchestrationState,
  completedStepCount: number,
): OrchestrationDirective {
  const artifactDirective = artifactVerificationDirective(state.artifactVerification);
  if (completedStepCount >= FINAL_RESPONSE_STEP_INDEX) {
    const hasIncompleteWork =
      state.executionPlan.status === "pending" ||
      state.executionPlan.status === "failed" ||
      artifactDirective != null;
    return {
      kind: "final",
      instruction:
        (hasIncompleteWork
          ? "本轮已保留已生成的产物，但仍有工作或质量校验未完成。请根据上方工具卡片中的结果继续处理。"
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
      instruction: `Read the selected Plan document ${state.executionPlan.documentId} from offset ${state.executionPlan.coveredThrough} before executing it.`,
    };
  }
  if (artifactDirective?.toolName) {
    return { kind: "exact-tools", directive: artifactDirective };
  }
  if (artifactDirective) {
    return {
      kind: "final",
      instruction: "HTML 产物已生成，但质量校验未通过，自动修复未能继续。请根据上方校验结果调整后重试。",
    };
  }
  return { kind: "default" };
}
