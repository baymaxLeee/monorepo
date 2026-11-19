import {
  experimental_createSteering,
  type Experimental_SteeringNotDeliveredReason,
  type Experimental_SteeringOutcome,
} from "ai";

export type AgentRunInputMode = "follow-up" | "next-turn";

export interface AgentRunInputChannel {
  readonly steering: ReturnType<typeof experimental_createSteering>;
  submit(text: string, options: { id: string; mode: AgentRunInputMode }): Promise<Experimental_SteeringOutcome>;
}

export const FOLLOW_UP_REORIENTATION_INSTRUCTION = [
  "<follow_up_reorientation>",
  "A new user message was added to this running turn. Re-evaluate the active plan before choosing the next action.",
  "Classify the update as adding work, modifying work, cancelling work, or supplying context. Apply the smallest change that satisfies it: keep completed work and unaffected pending work, and cancel or replace only what the user explicitly changes.",
  "The latest explicit instruction wins only where it conflicts with an earlier instruction. Extra context does not by itself pause, cancel, reorder, or replace the original task.",
  "Do not manufacture an acknowledgement step or interrupt useful work merely because an update arrived. If the user explicitly requests a different order, an immediate answer, or cancellation, honor that request as the new constraint.",
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
  return {
    steering,
    submit: (text, { id, mode }) =>
      mode === "next-turn" ? steering.queue(text, { id }) : steering.steer(text, { id }),
  };
}

export type AgentRunInputOutcome = Experimental_SteeringOutcome;
export type AgentRunInputNotDeliveredReason = Experimental_SteeringNotDeliveredReason;
