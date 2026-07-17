import {
  reduceArtifactVerificationEvents,
  type ArtifactVerificationEvent,
  type ArtifactVerificationState,
} from "../../../domain/agent/artifact-verification.js";
import { isToolOutcome, toolOutcomeData } from "../tools/outcome.js";

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toEvent(raw: unknown): ArtifactVerificationEvent | null {
  const part = recordValue(raw);
  if (!part || typeof part.toolCallId !== "string" || typeof part.toolName !== "string") return null;
  if (part.type === "tool-error") {
    return {
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      outcome: {
        kind: "failed",
        message: `${part.toolName} failed during the internal quality gate`,
      },
    };
  }
  if (part.type !== "tool-result") return null;
  if (isToolOutcome(part.output) && part.output.status === "completed") {
    return {
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      outcome: { kind: "completed", data: toolOutcomeData(part.output) },
    };
  }
  return {
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    outcome: {
      kind: "failed",
      message:
        isToolOutcome(part.output) && part.output.ok === false
          ? part.output.error.message
          : `${part.toolName} returned an invalid outcome during the internal quality gate`,
    },
  };
}

export function reduceArtifactVerificationSteps(
  initial: ArtifactVerificationState,
  steps: ReadonlyArray<{ content: ReadonlyArray<unknown> }>,
): ArtifactVerificationState {
  const events = steps.flatMap((step) => step.content.flatMap((part) => {
    const event = toEvent(part);
    return event ? [event] : [];
  }));
  return reduceArtifactVerificationEvents(initial, events);
}
