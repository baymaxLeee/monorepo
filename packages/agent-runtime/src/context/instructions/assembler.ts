import { buildInstructionPlan, renderAvailableSkills } from "./plan.js";
import type { InstructionContributions, InstructionInput } from "./types.js";

/**
 * Stable run-level instructions only. Tool workflows live with tool definitions;
 * step facts enter the transcript through context events.
 */
export function assembleInstructions(input: InstructionInput, contributions: InstructionContributions = {}): string {
  return buildInstructionPlan({ input, contributions }).render();
}

export { renderAvailableSkills };
