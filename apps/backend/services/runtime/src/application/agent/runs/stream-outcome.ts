import type { FinishReason, UIMessageStreamOutcome } from "ai";

export function terminalStreamError(
  outcome: UIMessageStreamOutcome,
  finishReason: FinishReason | undefined,
): unknown | null {
  if (outcome.status === "failed") {
    return outcome.error ?? "model stream ended with an error";
  }
  if (finishReason === "error") {
    return "model stream ended with an error";
  }
  if (outcome.status === "aborted") {
    return "model stream timed out or aborted unexpectedly";
  }
  return null;
}
