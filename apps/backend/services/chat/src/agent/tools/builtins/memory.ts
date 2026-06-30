import { tool } from "ai";
import { z } from "zod";

import { createMemoryCandidate, listActiveMemories } from "../../memory/repository.js";
import { memoryToolContextSchema, type MemoryToolContext } from "../context.js";

type MemoryInput = {
  category: "preference" | "profile" | "project" | "instruction";
  content: string;
  reason: string;
};

const memoryInputSchema = z.object({
  category: z.enum(["preference", "profile", "project", "instruction"]),
  content: z.string().min(5).max(500),
  reason: z.string().min(1).max(200),
});

async function createMemory(input: MemoryInput, { context }: { context: MemoryToolContext }) {
  try {
    const candidate = await createMemoryCandidate({
      userId: context.userId,
      category: input.category,
      content: input.content,
      reason: input.reason,
      originRunId: context.runId,
      source: "user-requested",
    });
    return {
      ok: true,
      staged: candidate.status === "pending",
      candidate_id: candidate.id,
      status: candidate.status,
    };
  } catch (error) {
    return {
      ok: false,
      error: `failed to create memory proposal: ${String(error).slice(0, 500)}`,
    };
  }
}

async function updateMemory(
  input: MemoryInput & { memory_id: string },
  { context }: { context: MemoryToolContext },
) {
  try {
    const active = (await listActiveMemories(context.userId)).find(
      (memory) => memory.id === input.memory_id,
    );
    if (!active) {
      return { ok: false, error: `active memory ${input.memory_id} was not found` };
    }
    const candidate = await createMemoryCandidate({
      userId: context.userId,
      category: input.category,
      content: input.content,
      reason: input.reason,
      originRunId: context.runId,
      source: "user-requested-update",
      supersedesId: active.id,
    });
    return {
      ok: true,
      staged: candidate.status === "pending",
      candidate_id: candidate.id,
      supersedes_id: active.id,
      status: candidate.status,
    };
  } catch (error) {
    return {
      ok: false,
      error: `failed to update memory proposal: ${String(error).slice(0, 500)}`,
    };
  }
}

export function createMemoryTools() {
  return {
    create_memory: tool({
      description:
        "Stage a new long-term memory for non-blocking user review. It is not active until the user approves it in the memory panel.",
      inputSchema: memoryInputSchema,
      contextSchema: memoryToolContextSchema,
      execute: createMemory,
    }),
    update_memory: tool({
      description:
        "Stage a replacement for an active memory. The old memory remains active until the user approves the candidate.",
      inputSchema: memoryInputSchema.extend({ memory_id: z.string().min(1).max(32) }),
      contextSchema: memoryToolContextSchema,
      execute: updateMemory,
    }),
  };
}
