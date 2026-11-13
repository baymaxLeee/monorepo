import {
  experimental_createSteering,
  type Experimental_Steering,
  type Experimental_SteeringNotDeliveredReason,
  type Experimental_SteeringOutcome,
} from "ai";

/**
 * Create one SDK-owned input channel for one ToolLoopAgent invocation.
 * Hosts own admission and persistence; the SDK owns step-boundary delivery.
 */
export function createAgentSteering(): Experimental_Steering {
  return experimental_createSteering();
}

export type AgentSteering = Experimental_Steering;
export type AgentSteeringOutcome = Experimental_SteeringOutcome;
export type AgentSteeringNotDeliveredReason = Experimental_SteeringNotDeliveredReason;
