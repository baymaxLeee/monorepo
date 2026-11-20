import {
  experimental_createSteering,
  type Experimental_SteeringNotDeliveredReason,
  type Experimental_SteeringOutcome,
  type UserModelMessage,
} from "ai";

export type RuntimeInputMode = "follow-up" | "next-turn";

export interface RuntimeInputQueue {
  submit(text: string, options: { id: string; mode: RuntimeInputMode }): Promise<Experimental_SteeringOutcome>;
}

/**
 * Create one runtime-owned input queue for one ToolLoopAgent invocation.
 * `follow-up` updates the active turn at the next safe model boundary;
 * `next-turn` waits for the active task's final answer. Explicit interruption
 * remains a separate host action and never hides behind input admission.
 */
export function createRuntimeInputQueue() {
  const steering = experimental_createSteering();
  const outcomes = new Map<string, Promise<Experimental_SteeringOutcome>>();
  const pending = new Map<string, (reason: Experimental_SteeringNotDeliveredReason) => void>();
  let closed: Experimental_SteeringNotDeliveredReason | undefined;
  const submit: RuntimeInputQueue["submit"] = (text, { id, mode }) => {
    const existing = outcomes.get(id);
    if (existing) return existing;
    const message = { role: "user", content: text } satisfies UserModelMessage;
    const outcome = new Promise<Experimental_SteeringOutcome>((resolve) => {
      const rejectDelivery = (reason: Experimental_SteeringNotDeliveredReason) =>
        resolve({ type: "not-delivered", reason, message, id });
      if (closed) {
        rejectDelivery(closed);
        return;
      }
      pending.set(id, rejectDelivery);
      const delivery = mode === "next-turn" ? steering.queue(message, { id }) : steering.steer(message, { id });
      void delivery.then((result) => {
        pending.delete(id);
        resolve(result);
      });
    });
    outcomes.set(id, outcome);
    return outcome;
  };
  return {
    steering,
    submit,
    close(reason: Experimental_SteeringNotDeliveredReason) {
      closed ??= reason;
      for (const settle of pending.values()) settle(closed);
      pending.clear();
    },
  };
}

export type RuntimeInputOutcome = Experimental_SteeringOutcome;
export type RuntimeInputNotDeliveredReason = Experimental_SteeringNotDeliveredReason;
