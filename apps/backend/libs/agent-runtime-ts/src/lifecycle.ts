import { isToolUIPart, type UIMessage } from "ai";

import { isToolOutcome } from "./outcome.js";

type AnyUIMessage = UIMessage<unknown, any, any>;
type AnyPart = AnyUIMessage["parts"][number];
const NON_TERMINAL_OUTPUT_STATUSES = new Set(["generating", "pending", "queued", "running", "submitted"]);

function approvalId(part: AnyPart): string | undefined {
  if (!isToolUIPart(part) || part.state !== "approval-requested") return undefined;
  return part.approval.id;
}

/** Apply one SDK-native approval response. Approval ids are one-shot and unique within a thread journal. */
export function applyToolApprovalResponse(
  messages: AnyUIMessage[],
  response: { approvalId: string; approved: boolean },
): AnyUIMessage[] {
  let matches = 0;
  const updated = messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (!isToolUIPart(part) || part.state !== "approval-requested" || part.approval.id !== response.approvalId) {
        return part;
      }
      matches += 1;
      return {
        ...part,
        state: "approval-responded" as const,
        approval: { ...part.approval, approved: response.approved },
      } as AnyPart;
    }),
  })) as AnyUIMessage[];
  if (matches === 0) throw new Error("审批不存在或已处理");
  if (matches !== 1) throw new Error("审批标识重复，运行记录已损坏");
  return updated;
}

export function hasPendingToolApprovals(messages: AnyUIMessage[]): boolean {
  return messages.some((message) => message.parts.some((part) => approvalId(part) !== undefined));
}

export function hasNonTerminalOutput(output: unknown): boolean {
  if (isToolOutcome(output)) return output.status === "running";
  if (!output || typeof output !== "object") return false;
  const status = (output as { status?: unknown }).status;
  return typeof status === "string" && NON_TERMINAL_OUTPUT_STATUSES.has(status);
}

/**
 * Convert every unfinished SDK tool part into a terminal error without replaying it.
 * Hosts may pre-transform domain outputs, but interruption semantics stay shared.
 */
export function finalizeInterruptedParts(parts: AnyPart[], reason: string): AnyPart[] {
  return parts.map((part) => {
    if (!isToolUIPart(part) || part.state === "output-error" || part.state === "output-denied") {
      return part;
    }
    if (part.state === "output-available" && part.preliminary !== true && !hasNonTerminalOutput(part.output))
      return part;
    const value = part as unknown as Record<string, unknown>;
    const { output: _output, preliminary: _preliminary, approval, ...terminal } = value;
    const granted =
      approval && typeof approval === "object" && "approved" in approval && approval.approved === true
        ? approval
        : undefined;
    return {
      ...terminal,
      ...(granted ? { approval: granted } : {}),
      state: "output-error",
      errorText: reason,
    } as AnyPart;
  });
}

export function finalizeInterruptedMessages(messages: AnyUIMessage[], reason: string): AnyUIMessage[] {
  return messages.map((message) => ({ ...message, parts: finalizeInterruptedParts(message.parts, reason) }));
}
