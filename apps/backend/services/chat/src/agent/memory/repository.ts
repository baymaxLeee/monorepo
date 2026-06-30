// Durable user memory shared by context projection, memory tools, and CRUD routes.
import { createHash } from "node:crypto";

import { and, asc, eq, inArray } from "drizzle-orm";

import { getDb } from "../../db/index.js";
import { userMemories } from "../../db/schema.js";

export type MemoryCategory = "preference" | "profile" | "project" | "instruction";

function deterministicId(...parts: Array<string | number | null | undefined>): string {
  return createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join(":"))
    .digest("hex")
    .slice(0, 32);
}

export type MemoryStatus = "pending" | "active" | "rejected" | "superseded";

export interface UserMemory {
  id: string;
  category: MemoryCategory;
  content: string;
  confidence: number;
}

export interface MemoryCandidate {
  id: string;
  category: MemoryCategory;
  content: string;
  reason: string | null;
  supersedesId: string | null;
  createdAt: string;
}

function isoOrEmpty(d: Date | null): string {
  return d ? d.toISOString().replace("+00:00", "Z") : "";
}

export async function listActiveMemories(userId: string): Promise<UserMemory[]> {
  const rows = await getDb()
    .select()
    .from(userMemories)
    .where(and(eq(userMemories.userId, userId), eq(userMemories.status, "active")))
    .orderBy(asc(userMemories.createdAt));
  return rows.map((row) => ({
    id: row.id,
    category: row.category as MemoryCategory,
    content: row.content,
    confidence: row.confidence,
  }));
}

export async function listPendingCandidates(userId: string): Promise<MemoryCandidate[]> {
  const rows = await getDb()
    .select()
    .from(userMemories)
    .where(and(eq(userMemories.userId, userId), eq(userMemories.status, "pending")))
    .orderBy(asc(userMemories.createdAt));
  return rows.map((row) => ({
    id: row.id,
    category: row.category as MemoryCategory,
    content: row.content,
    reason: row.reason,
    supersedesId: row.supersedesId,
    createdAt: isoOrEmpty(row.createdAt),
  }));
}

export async function listMemoryDedupEntries(
  userId: string,
): Promise<Array<{ category: MemoryCategory; content: string; status: MemoryStatus }>> {
  const rows = await getDb()
    .select({
      category: userMemories.category,
      content: userMemories.content,
      status: userMemories.status,
    })
    .from(userMemories)
    .where(
      and(
        eq(userMemories.userId, userId),
        inArray(userMemories.status, ["active", "pending", "rejected"]),
      ),
    );
  return rows.map((row) => ({
    category: row.category as MemoryCategory,
    content: row.content,
    status: row.status as MemoryStatus,
  }));
}

export async function createMemoryCandidate(input: {
  userId: string;
  category: MemoryCategory;
  content: string;
  reason?: string | null;
  originRunId?: string | null;
  supersedesId?: string | null;
  source?: string;
}): Promise<MemoryCandidate & { status: MemoryStatus }> {
  const content = input.content.trim().replace(/\s+/g, " ");
  const [existing] = await getDb()
    .select()
    .from(userMemories)
    .where(
      and(
        eq(userMemories.userId, input.userId),
        eq(userMemories.category, input.category),
        eq(userMemories.content, content),
        inArray(userMemories.status, ["active", "pending", "rejected"]),
      ),
    );
  if (existing) {
    return {
      id: existing.id,
      category: existing.category as MemoryCategory,
      content: existing.content,
      reason: existing.reason,
      supersedesId: existing.supersedesId,
      createdAt: isoOrEmpty(existing.createdAt),
      status: existing.status as MemoryStatus,
    };
  }
  const now = new Date();
  const row = {
    id: deterministicId("memory-candidate", input.userId, input.category, content.toLowerCase()),
    userId: input.userId,
    category: input.category,
    content,
    source: input.source ?? "agent-extracted",
    confidence: 80,
    status: "pending",
    reason: input.reason ?? null,
    originRunId: input.originRunId ?? null,
    supersedesId: input.supersedesId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await getDb()
    .insert(userMemories)
    .values(row)
    .onDuplicateKeyUpdate({
      // A retry or repeated proposal must not demote an active/rejected row
      // back to pending. The deterministic primary key makes this a no-op.
      set: { id: row.id },
    });
  const [stored] = await getDb()
    .select()
    .from(userMemories)
    .where(and(eq(userMemories.id, row.id), eq(userMemories.userId, input.userId)));
  if (!stored) throw new Error("memory candidate insert did not persist");
  return {
    id: stored.id,
    category: stored.category as MemoryCategory,
    content: stored.content,
    reason: stored.reason,
    supersedesId: stored.supersedesId,
    createdAt: isoOrEmpty(stored.createdAt),
    status: stored.status as MemoryStatus,
  };
}

async function getOwnedMemory(userId: string, memoryId: string) {
  const [row] = await getDb()
    .select()
    .from(userMemories)
    .where(and(eq(userMemories.id, memoryId), eq(userMemories.userId, userId)));
  return row ?? null;
}

export async function approveCandidate(userId: string, candidateId: string): Promise<UserMemory | null> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select()
      .from(userMemories)
      .where(
        and(
          eq(userMemories.id, candidateId),
          eq(userMemories.userId, userId),
          eq(userMemories.status, "pending"),
        ),
      )
      .for("update");
    if (!candidate) return null;

    const now = new Date();
    if (candidate.supersedesId) {
      await tx
        .update(userMemories)
        .set({ status: "superseded", updatedAt: now })
        .where(
          and(
            eq(userMemories.id, candidate.supersedesId),
            eq(userMemories.userId, userId),
            eq(userMemories.status, "active"),
          ),
        );
    }
    await tx
      .update(userMemories)
      .set({ status: "active", source: "user-approved", confidence: 100, updatedAt: now })
      .where(
        and(
          eq(userMemories.id, candidateId),
          eq(userMemories.userId, userId),
          eq(userMemories.status, "pending"),
        ),
      );
    return {
      id: candidate.id,
      category: candidate.category as MemoryCategory,
      content: candidate.content,
      confidence: 100,
    };
  });
}

export async function rejectCandidate(userId: string, candidateId: string): Promise<boolean> {
  const candidate = await getOwnedMemory(userId, candidateId);
  if (!candidate || candidate.status !== "pending") return false;
  await getDb()
    .update(userMemories)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(eq(userMemories.id, candidateId));
  return true;
}

export async function updateCandidate(
  userId: string,
  candidateId: string,
  patch: { category?: MemoryCategory; content?: string },
): Promise<MemoryCandidate | null> {
  const candidate = await getOwnedMemory(userId, candidateId);
  if (!candidate || candidate.status !== "pending") return null;
  const content = patch.content?.trim().replace(/\s+/g, " ");
  await getDb()
    .update(userMemories)
    .set({
      category: patch.category ?? undefined,
      content: content ?? undefined,
      updatedAt: new Date(),
    })
    .where(eq(userMemories.id, candidateId));
  return {
    id: candidate.id,
    category: (patch.category ?? candidate.category) as MemoryCategory,
    content: content ?? candidate.content,
    reason: candidate.reason,
    supersedesId: candidate.supersedesId,
    createdAt: isoOrEmpty(candidate.createdAt),
  };
}

export async function deleteMemory(userId: string, memoryId: string): Promise<boolean> {
  const memory = await getOwnedMemory(userId, memoryId);
  if (!memory) return false;
  await getDb()
    .delete(userMemories)
    .where(and(eq(userMemories.id, memoryId), eq(userMemories.userId, userId)));
  return true;
}
