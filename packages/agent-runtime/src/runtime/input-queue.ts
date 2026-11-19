import {
  experimental_createSteering,
  type Experimental_SteeringNotDeliveredReason,
  type Experimental_SteeringOutcome,
  type UserModelMessage,
} from "ai";

export type RuntimeInputMode = "follow-up" | "next-turn";

/** Raw finish marker consumed by hosts that maintain provider response lineage. */
export const RUNTIME_FOLLOW_UP_PREEMPTED_FINISH_REASON = "follow-up-preempted";

export interface RuntimeInputActivity {
  modeFor(message: UserModelMessage): RuntimeInputMode | undefined;
  followUpVersionFor(message: UserModelMessage): number | undefined;
  currentFollowUpVersion(): number;
  subscribeFollowUp(listener: (version: number) => void): () => void;
}

export interface RuntimeInputQueue {
  readonly steering: ReturnType<typeof experimental_createSteering>;
  readonly activity: RuntimeInputActivity;
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
  const activities = new WeakMap<UserModelMessage, { mode: RuntimeInputMode; followUpVersion?: number }>();
  const listeners = new Set<(version: number) => void>();
  const outcomes = new Map<string, Promise<Experimental_SteeringOutcome>>();
  let followUpVersion = 0;
  return {
    steering,
    activity: {
      modeFor: (message) => activities.get(message)?.mode,
      followUpVersionFor: (message) => activities.get(message)?.followUpVersion,
      currentFollowUpVersion: () => followUpVersion,
      subscribeFollowUp: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    submit: (text, { id, mode }) => {
      const existing = outcomes.get(id);
      if (existing) return existing;
      const message = { role: "user", content: text } satisfies UserModelMessage;
      const nextFollowUpVersion = mode === "follow-up" ? followUpVersion + 1 : undefined;
      activities.set(message, { mode, followUpVersion: nextFollowUpVersion });
      const outcome = mode === "next-turn" ? steering.queue(message, { id }) : steering.steer(message, { id });
      outcomes.set(id, outcome);
      if (nextFollowUpVersion !== undefined) {
        followUpVersion = nextFollowUpVersion;
        for (const listener of listeners) listener(followUpVersion);
      }
      return outcome;
    },
  };
}

export type RuntimeInputOutcome = Experimental_SteeringOutcome;
export type RuntimeInputNotDeliveredReason = Experimental_SteeringNotDeliveredReason;
