import {
  KnowledgeInternalClient,
  type ArtifactBlockPlan,
  type ArtifactGeneration,
  type ArtifactGenerationDetail,
  type ArtifactRevisionWorkspace,
  type KnowledgeDocument,
  type PublishedArtifactRevision,
  type StoredArtifactBlock,
} from "@backend/transport-ts";

import { getSettings } from "../config.js";

export type {
  ArtifactBlockPlan,
  ArtifactGeneration,
  ArtifactGenerationDetail,
  ArtifactRevisionWorkspace,
  KnowledgeDocument,
  PublishedArtifactRevision,
  StoredArtifactBlock,
} from "@backend/transport-ts";

function knowledgeClient(): KnowledgeInternalClient {
  const s = getSettings();
  return new KnowledgeInternalClient({
    baseUrl: s.knowledgeServiceUrl,
    internalToken: s.internalApiToken,
  });
}

export async function getDocument(userId: string, documentId: string): Promise<KnowledgeDocument> {
  return knowledgeClient().getDocument({ userId, documentId });
}

export async function getLatestArtifactWorkspace(
  userId: string,
  documentId: string,
): Promise<ArtifactRevisionWorkspace> {
  return knowledgeClient().getLatestArtifactWorkspace({ userId, documentId });
}

// No claim/renew/listClaimable here on purpose: Workflow DevKit's own step
// retry and durable execution replace the multi-worker job-queue racing that
// those existed for in chat's old hand-rolled worker (see chat's AGENTS.md
// history / the agent_task_执行时服务 plan). One workflow run == one owner.

export async function reserveArtifactGeneration(input: {
  userId: string;
  conversationId?: string;
  title: string;
  filename: string;
  mode: "document" | "presentation" | "dashboard";
  brief: string;
  idempotencyKey: string;
  documentId?: string;
  resumeGenerationId?: string;
}): Promise<ArtifactGeneration> {
  return knowledgeClient().reserveArtifactGeneration(input);
}

export async function saveArtifactPlan(input: {
  userId: string;
  generationId: string;
  manifest: Record<string, unknown>;
  blocks: ArtifactBlockPlan[];
}): Promise<ArtifactGeneration> {
  return knowledgeClient().saveArtifactPlan(input);
}

export async function saveArtifactBlock(input: {
  userId: string;
  generationId: string;
  blockId: string;
  content: string;
  failed?: boolean;
}): Promise<ArtifactGeneration> {
  return knowledgeClient().saveArtifactBlock(input);
}

export async function listArtifactBlocks(
  userId: string,
  generationId: string,
): Promise<StoredArtifactBlock[]> {
  return knowledgeClient().listArtifactBlocks({ userId, generationId });
}

export async function publishArtifactRevision(input: {
  userId: string;
  generationId: string;
  compiledHtml: string;
}): Promise<PublishedArtifactRevision> {
  return knowledgeClient().publishArtifactRevision(input);
}

export async function getArtifactGeneration(
  userId: string,
  generationId: string,
): Promise<ArtifactGenerationDetail> {
  return knowledgeClient().getArtifactGeneration({ userId, generationId });
}

export async function failArtifactGeneration(input: {
  userId: string;
  generationId: string;
  error?: string;
}): Promise<ArtifactGeneration> {
  return knowledgeClient().failArtifactGeneration({ ...input, owner: "executor" });
}

export async function cancelArtifactGeneration(input: {
  userId: string;
  generationId: string;
}): Promise<ArtifactGeneration> {
  return knowledgeClient().cancelArtifactGeneration({ ...input, owner: "executor" });
}
