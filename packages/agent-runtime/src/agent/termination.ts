import { isToolOutcome, type ToolIssue } from "../tools/outcome.js";

export const MAX_AGENT_STEPS = 50;
const FINAL_RESPONSE_STEP_INDEX = MAX_AGENT_STEPS - 1;

const TERMINAL_TOOL_CODES = new Set([
  "CODE_MODE_TIMEOUT",
  "COMMAND_TIMEOUT",
  "INTERNAL_TOOL_PROTOCOL_ERROR",
  "PROVIDER_RATE_LIMITED",
  "SANDBOX_UNAVAILABLE",
  "SERVICE_PERMISSION_DENIED",
]);

export type TerminalToolStop = { toolName: string; issue: ToolIssue };

export function isTerminalToolIssue(issue: ToolIssue): boolean {
  return TERMINAL_TOOL_CODES.has(issue.code);
}

/**
 * Observe facts already returned by tools. This deliberately does not plan,
 * count failures, choose recovery tools, or replay calls on the model's behalf.
 */
export function createTerminationLatch() {
  let skillLoaded = false;
  const stops = new Map<string, TerminalToolStop>();
  return {
    observe(toolName: string, value: unknown) {
      if (!isToolOutcome(value) || value.status === "running") return value;
      if (toolName === "load_skill" && value.status === "completed") skillLoaded = true;
      if (value.ok === false && isTerminalToolIssue(value.error)) {
        stops.set(`${toolName}:${value.error.code}`, { toolName, issue: value.error });
      }
      return value;
    },
    skillLoaded: () => skillLoaded,
    stops: () => [...stops.values()].sort((left, right) => left.toolName.localeCompare(right.toolName)),
  };
}

export function terminationInstruction(completedStepCount: number, stops: TerminalToolStop[]): string | undefined {
  if (stops.length > 0) {
    const evidence = stops
      .map(
        ({ toolName, issue }) =>
          `${toolName}: code=${issue.code}, source=${issue.source ?? toolName}, message=${issue.message}`,
      )
      .join("; ");
    return `A tool boundary ended active execution for this turn: ${evidence}. Do not call more tools. Answer from the evidence already collected. Explain the root cause, distinguish completed work from uncertain or incomplete work, and give a concrete recovery or retry recommendation.`;
  }
  if (completedStepCount >= FINAL_RESPONSE_STEP_INDEX) {
    return "The final response step has been reached. Do not call tools. Report only outcomes supported by observed tool results, distinguish completed work from incomplete work, and never use a generic completion claim.";
  }
  return undefined;
}
