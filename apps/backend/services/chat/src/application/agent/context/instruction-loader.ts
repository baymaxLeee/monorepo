import type { BotProfileSnapshot, InstructionInput, MemoryDatum } from "@backend/agent-runtime-ts/instructions/index";

import type { AgentMode } from "../agents/types.js";
import { listActiveMemories } from "../memory/repository.js";

export async function loadInstructionContext(params: {
  userId: string;
  mode: AgentMode;
  botProfile?: BotProfileSnapshot | null;
}): Promise<InstructionInput> {
  const memories = await listActiveMemories(params.userId);

  const memoryData: MemoryDatum[] = memories.map((memory) => ({
    id: memory.id,
    category: memory.category,
    confidence: memory.confidence,
    content: memory.content,
  }));

  return {
    mode: params.mode,
    botProfile: params.botProfile ?? null,
    memories: memoryData,
    activatedSkill: null,
  };
}
