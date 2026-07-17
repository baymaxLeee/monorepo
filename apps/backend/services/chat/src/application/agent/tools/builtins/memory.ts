import { tool } from "ai";
import { z } from "zod";

import { createMemoryCandidate, listActiveMemories } from "../../memory/repository.js";
import { memoryToolContextSchema, type MemoryToolContext } from "../context.js";
import { defineAgentTool } from "../manifest.js";
import { ToolBlockedError } from "../outcome.js";

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

const memoryProposalOutputSchema = z.object({
  status: z.literal("proposed"),
  candidate_id: z.string(),
  supersedes_id: z.string().optional(),
});

async function createMemory(input: MemoryInput, { context }: { context: MemoryToolContext }) {
  const candidate = await createMemoryCandidate({
    userId: context.userId,
    category: input.category,
    content: input.content,
    reason: input.reason,
    originRunId: context.runId,
    source: "user-requested",
  });
  return { status: "proposed" as const, candidate_id: candidate.id };
}

async function updateMemory(
  input: MemoryInput & { memory_id: string },
  { context }: { context: MemoryToolContext },
) {
  const active = (await listActiveMemories(context.userId)).find(
    (memory) => memory.id === input.memory_id,
  );
  if (!active) {
    throw new ToolBlockedError({
      code: "MEMORY_NOT_FOUND",
      message: `active memory ${input.memory_id} was not found`,
      retryable: false,
      source: "memory",
      details: { memory_id: input.memory_id },
    });
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
    status: "proposed" as const,
    candidate_id: candidate.id,
    supersedes_id: active.id,
  };
}

export function createMemoryToolManifests() {
  return [
    defineAgentTool(
      "create_memory",
      tool({
        description: "Propose a new long-term memory. It remains inactive until the user approves it.",
        inputSchema: memoryInputSchema,
        outputSchema: memoryProposalOutputSchema,
        contextSchema: memoryToolContextSchema,
        execute: createMemory,
      }),
      {
        capability: "memory",
        effect: "add",
        trust: "closed",
        execution: "inline",
        modes: ["normal"],
      },
      { summary: "Propose a new long-term memory for user approval." },
    ),
    defineAgentTool(
      "update_memory",
      tool({
        description: "Propose a replacement for an active memory. The current memory remains active until approval.",
        inputSchema: memoryInputSchema.extend({ memory_id: z.string().min(1).max(32) }),
        outputSchema: memoryProposalOutputSchema,
        contextSchema: memoryToolContextSchema,
        execute: updateMemory,
      }),
      {
        capability: "memory",
        effect: "update",
        trust: "closed",
        execution: "inline",
        modes: ["normal"],
      },
      { summary: "Propose replacing an active memory after user approval." },
    ),
  ];
}
