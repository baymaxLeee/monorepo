import {
  experimental_createSteering,
  type Experimental_SteeringNotDeliveredReason,
  type Experimental_SteeringOutcome,
  type UserModelMessage,
} from "ai";

export type AgentRunInputMode = "follow-up" | "next-turn";

export interface AgentRunInputActivity {
  modeFor(message: UserModelMessage): AgentRunInputMode | undefined;
  followUpVersionFor(message: UserModelMessage): number | undefined;
  currentFollowUpVersion(): number;
  subscribeFollowUp(listener: (version: number) => void): () => void;
}

export interface AgentRunInputChannel {
  readonly steering: ReturnType<typeof experimental_createSteering>;
  readonly activity: AgentRunInputActivity;
  submit(text: string, options: { id: string; mode: AgentRunInputMode }): Promise<Experimental_SteeringOutcome>;
}

export const FOLLOW_UP_REORIENTATION_INSTRUCTION = [
  "<follow_up_reorientation>",
  "A new user message was added to this running turn. Re-evaluate the active plan before choosing the next action.",
  "Classify the update as adding work, modifying work, cancelling work, or supplying context. Apply the smallest change that satisfies it: keep completed work and unaffected pending work, and cancel or replace only what the user explicitly changes.",
  "The latest explicit instruction wins only where it conflicts with an earlier instruction. Extra context does not by itself pause, cancel, reorder, or replace the original task.",
  "Address the update first with concise user-visible text before any further tool execution. This is a response boundary, not an automatic task cancellation: after satisfying the update, continue all unaffected work in the same turn.",
  "If the user explicitly requests a different order, an immediate answer, or cancellation, honor that request as the new constraint.",
  "</follow_up_reorientation>",
].join("\n");

/**
 * Create one product-owned input channel for one ToolLoopAgent invocation.
 * `follow-up` updates the active turn at the next safe model boundary;
 * `next-turn` waits for the active task's final answer. Explicit interruption
 * remains a separate host action and never hides behind input admission.
 */
export function createAgentRunInputChannel(): AgentRunInputChannel {
  const steering = experimental_createSteering();
  const activities = new WeakMap<UserModelMessage, { mode: AgentRunInputMode; followUpVersion?: number }>();
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

export type AgentRunInputOutcome = Experimental_SteeringOutcome;
export type AgentRunInputNotDeliveredReason = Experimental_SteeringNotDeliveredReason;
