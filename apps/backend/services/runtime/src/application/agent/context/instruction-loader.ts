import type { InstructionInput, MemoryDatum } from "@repo/agent-runtime";

/** Product memory is projected by the upper host, never loaded from Runtime-owned identity state. */
export function loadInstructionContext(memories: readonly MemoryDatum[]): InstructionInput {
  return {
    memories: [...memories],
    activatedSkill: null,
  };
}
