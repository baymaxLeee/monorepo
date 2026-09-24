import { TransportError } from "@backend/transport-ts";
import { FatalError } from "workflow";
import { z } from "zod";

import { claimTaskStep } from "../src/application/tasks/binding.js";
import { indexKnowledgeDocument, processKnowledgeDocument } from "../src/infrastructure/clients/knowledge.js";

export const knowledgeDocumentProcessInputSchema = z.object({
  documentId: z.string().min(1).max(32),
  providerId: z.string().min(1).max(32).optional(),
});

type Input = z.infer<typeof knowledgeDocumentProcessInputSchema>;

function rethrowPermanent(error: unknown): never {
  if (error instanceof TransportError && [400, 401, 403, 404, 409].includes(error.status)) {
    throw new FatalError(error.message);
  }
  throw error;
}

async function convertStep(input: Input) {
  "use step";
  try {
    return await processKnowledgeDocument(input.documentId, input.providerId);
  } catch (error) {
    rethrowPermanent(error);
  }
}

async function indexStep(input: Input) {
  "use step";
  try {
    return await indexKnowledgeDocument(input.documentId);
  } catch (error) {
    rethrowPermanent(error);
  }
}

export async function knowledgeDocumentProcessWorkflow(input: Input, executorTaskId: string) {
  "use workflow";
  await claimTaskStep(executorTaskId);
  const conversion = await convertStep(input);
  if (["deleted", "not-source", "failed"].includes(conversion.state)) {
    return { conversion: conversion.state, indexing: "skipped" };
  }
  const indexing = await indexStep(input);
  return { conversion: conversion.state, indexing: indexing.state };
}
