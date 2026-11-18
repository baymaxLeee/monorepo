import type { InstructionInput, MemoryDatum } from "@repo/agent-runtime/instructions/index";

import { listActiveMemories } from "../memory/repository.js";

export async function loadInstructionContext(params: { userId: string }): Promise<InstructionInput> {
  const memories = await listActiveMemories(params.userId);

  const memoryData: MemoryDatum[] = memories.map((memory) => ({
    id: memory.id,
    category: memory.category,
    confidence: memory.confidence,
    content: memory.content,
  }));

  return {
    memories: memoryData,
    activatedSkill: null,
  };
}
