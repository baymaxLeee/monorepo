export type TurnRecoveryDecision =
  | "resume-next-step"
  | "resume-waiting"
  | "regenerate-model"
  | "reconcile-effect"
  | "interrupt";

export interface TurnRecoveryBoundary {
  /** A frozen snapshot and journal generation can rebuild the exact attempt boundary. */
  hasResumeEnvelope: boolean;
  cancellationRequested: boolean;
  waitingForClient: boolean;
  committedStep: boolean;
  toolEffect: "none" | "committed" | "unconfirmed";
}

/** Classify recovery from persisted facts only. This never inspects or serializes
 * a ToolLoopAgent instance, promise, stream or JavaScript instruction position. */
export function classifyTurnRecovery(boundary: TurnRecoveryBoundary): TurnRecoveryDecision {
  if (boundary.cancellationRequested) return "interrupt";
  if (boundary.toolEffect === "unconfirmed") return "reconcile-effect";
  if (!boundary.hasResumeEnvelope) return "interrupt";
  if (boundary.waitingForClient) return "resume-waiting";
  // A committed effect without its SDK step is not enough to reconstruct the
  // model transcript: hosts may intentionally persist only redacted tool input.
  // Cross-attempt replay is safe once the committed step carries the call id.
  if (boundary.committedStep) return "resume-next-step";
  if (boundary.toolEffect === "committed") return "interrupt";
  return "regenerate-model";
}
