import {
  experimental_createSteering,
  type Experimental_SteeringNotDeliveredReason,
  type Experimental_SteeringOutcome,
  type UserModelMessage,
} from "ai";

export type RuntimeInputMode = "follow-up" | "next-turn";

export interface RuntimeInputQueue {
  readonly steering: ReturnType<typeof experimental_createSteering>;
  submit(text: string, options: { id: string; mode: RuntimeInputMode }): Promise<Experimental_SteeringOutcome>;
}

/**
 * Create one runtime-owned input queue for one ToolLoopAgent invocation.
 * `follow-up` updates the active turn at the next safe model boundary;
 * `next-turn` waits for the active task's final answer. Explicit interruption
 * remains a separate host action and never hides behind input admission.
 */
export function createRuntimeInputQueue(): RuntimeInputQueue {
  const steering = experimental_createSteering();
  const outcomes = new Map<string, Promise<Experimental_SteeringOutcome>>();
  return {
    steering,
    submit: (text, { id, mode }) => {
      const existing = outcomes.get(id);
      if (existing) return existing;
      const message = { role: "user", content: text } satisfies UserModelMessage;
      const outcome = mode === "next-turn" ? steering.queue(message, { id }) : steering.steer(message, { id });
      outcomes.set(id, outcome);
      return outcome;
    },
  };
}

export type RuntimeInputOutcome = Experimental_SteeringOutcome;
export type RuntimeInputNotDeliveredReason = Experimental_SteeringNotDeliveredReason;
