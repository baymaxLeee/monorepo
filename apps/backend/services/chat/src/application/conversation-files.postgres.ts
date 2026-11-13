import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";

import { and, eq } from "drizzle-orm";

import { getDb, getSql } from "../infrastructure/persistence/index.js";
import {
  assetClaimIntents,
  conversationFiles,
  conversationFileSaveOperations,
  conversationRunLeases,
  conversations,
} from "../infrastructure/persistence/schema.js";
import { saveConversationFile, type ConversationFileSaveCandidate } from "./conversation-files.js";
import { ConflictError } from "./errors.js";

const url = process.env.CHAT_FILE_SAVE_TEST_URL;
if (!url) throw new Error("CHAT_FILE_SAVE_TEST_URL must point to an isolated migrated Chat database");
const connection = new URL(url);
Object.assign(process.env, {
  ENVIRONMENT: "development",
  POSTGRES_HOST: connection.hostname,
  POSTGRES_PORT: connection.port,
  POSTGRES_USER: decodeURIComponent(connection.username),
  POSTGRES_PASSWORD: decodeURIComponent(connection.password),
  POSTGRES_DATABASE: connection.pathname.slice(1),
});

const scope = { userId: "file-save-test", tenantId: "tenant", workspaceId: "workspace" };
const id = () => randomBytes(16).toString("hex");
const etag = (token: string) => `"${token.padStart(32, "0")}"`;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

function candidate(content: string, assetId = randomUUID()): ConversationFileSaveCandidate {
  return {
    assetId,
    revisionId: randomUUID(),
    filename: "notes.md",
    mediaType: "text/markdown",
    sizeBytes: Buffer.byteLength(content),
    sha256: sha(content),
  };
}

test("conversation file save CAS, idempotency, no-op, and Claim switch", { timeout: 20_000 }, async (t) => {
  t.after(async () => getSql().end());

  async function seed() {
    const conversationId = id();
    const fileId = id();
    const now = new Date("2026-01-01T00:00:00.000Z");
    const assetId = randomUUID();
    const revisionId = randomUUID();
    await getDb()
      .insert(conversations)
      .values({
        id: conversationId,
        ...scope,
        title: "Save test",
        createdAt: now,
        updatedAt: now,
      });
    await getDb()
      .insert(conversationFiles)
      .values({
        id: fileId,
        conversationId,
        ...scope,
        assetId,
        revisionId,
        title: "Notes",
        filename: "notes.md",
        workspacePath: "/workspace/notes.md",
        mediaType: "text/markdown",
        sizeBytes: 4,
        sha256: sha("old\n"),
        kind: "artifact",
        idempotencyKey: `seed:${fileId}`,
        createdAt: now,
        updatedAt: now,
        contentGeneration: 1n,
        contentEtag: "00000000000000000000000000000001",
        lastWriterType: "unknown",
        lastWriterId: null,
      });
    await getDb().insert(assetClaimIntents).values({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      ownerType: "conversation_file",
      ownerId: fileId,
      slot: "source",
      assetId,
      revisionId,
      kind: "strong",
      generation: 1n,
      desiredState: "active",
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { conversationId, fileId, now, assetId, revisionId };
  }

  await t.test("success switches content once and response-loss retry returns the original result", async () => {
    const seeded = await seed();
    const next = candidate("new\n", seeded.assetId);
    let uploads = 0;
    const input = {
      ...scope,
      conversationId: seeded.conversationId,
      fileId: seeded.fileId,
      expectedEtag: etag("1"),
      contentSha256: next.sha256,
      operationId: "save-1",
      writerType: "user" as const,
      writerId: scope.userId,
    };
    const first = await saveConversationFile(input, async () => {
      uploads++;
      return next;
    });
    const replay = await saveConversationFile(input, async () => {
      uploads++;
      return candidate("wrong\n");
    });
    assert.equal(uploads, 1);
    assert.deepEqual(replay, first);
    assert.equal(first.id, seeded.fileId);
    assert.equal(first.asset_id, seeded.assetId);
    assert.equal(first.revision_id, next.revisionId);
    assert.notEqual(first.etag, input.expectedEtag);
    const [row] = await getDb().select().from(conversationFiles).where(eq(conversationFiles.id, seeded.fileId));
    assert.equal(row.contentGeneration, 2n);
    assert.equal(row.lastWriterType, "user");
    assert.equal(row.lastWriterId, scope.userId);
    const [claim] = await getDb().select().from(assetClaimIntents).where(eq(assetClaimIntents.ownerId, seeded.fileId));
    assert.equal(claim.assetId, seeded.assetId);
    assert.equal(claim.revisionId, next.revisionId);
    assert.equal(claim.generation, 2n);
    assert.equal(claim.deliveredAt, null);
    await assert.rejects(
      saveConversationFile({ ...input, contentSha256: sha("different") }, async () => candidate("different")),
      (error: unknown) => error instanceof ConflictError && error.code === "file_save_operation_conflict",
    );
  });

  await t.test("valid unchanged content is a no-op while a stale equal-content request conflicts", async () => {
    const seeded = await seed();
    let uploads = 0;
    const noChange = await saveConversationFile(
      {
        ...scope,
        conversationId: seeded.conversationId,
        fileId: seeded.fileId,
        expectedEtag: etag("1"),
        contentSha256: sha("old\n"),
        operationId: "no-change",
        writerType: "user",
        writerId: scope.userId,
      },
      async () => {
        uploads++;
        return candidate("old\n");
      },
    );
    assert.equal(uploads, 0);
    assert.equal(noChange.updated_at, seeded.now.toISOString());
    const changed = candidate("changed\n", seeded.assetId);
    await saveConversationFile(
      {
        ...scope,
        conversationId: seeded.conversationId,
        fileId: seeded.fileId,
        expectedEtag: etag("1"),
        contentSha256: changed.sha256,
        operationId: "change",
        writerType: "agent",
        writerId: "run",
      },
      async () => changed,
    );
    await assert.rejects(
      saveConversationFile(
        {
          ...scope,
          conversationId: seeded.conversationId,
          fileId: seeded.fileId,
          expectedEtag: etag("1"),
          contentSha256: changed.sha256,
          operationId: "stale-equal",
          writerType: "user",
          writerId: scope.userId,
        },
        async () => {
          uploads++;
          return changed;
        },
      ),
      (error: unknown) => error instanceof ConflictError && error.code === "file_content_conflict",
    );
    assert.equal(uploads, 0);
  });

  await t.test("two independent saves from one ETag upload independently but only one commits", async () => {
    const seeded = await seed();
    const a = candidate("a\n", seeded.assetId);
    const b = candidate("b\n", seeded.assetId);
    let ready = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const save = (operationId: string, next: ConversationFileSaveCandidate) =>
      saveConversationFile(
        {
          ...scope,
          conversationId: seeded.conversationId,
          fileId: seeded.fileId,
          expectedEtag: etag("1"),
          contentSha256: next.sha256,
          operationId,
          writerType: "user",
          writerId: scope.userId,
        },
        async () => {
          ready++;
          if (ready === 2) release();
          await gate;
          return next;
        },
      );
    const results = await Promise.allSettled([save("concurrent-a", a), save("concurrent-b", b)]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    assert.ok(rejected?.reason instanceof ConflictError);
    assert.equal(rejected.reason.code, "file_content_conflict");
    const operations = await getDb()
      .select()
      .from(conversationFileSaveOperations)
      .where(
        and(
          eq(conversationFileSaveOperations.conversationId, seeded.conversationId),
          eq(conversationFileSaveOperations.fileId, seeded.fileId),
        ),
      );
    assert.deepEqual(operations.map((operation) => operation.status).sort(), ["conflict", "succeeded"]);
  });

  await t.test("the save primitive accepts a user commit after workspace coordination", async () => {
    const seeded = await seed();
    await getDb()
      .insert(conversationRunLeases)
      .values({
        conversationId: seeded.conversationId,
        runId: id(),
        heartbeatAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });
    let uploaded = false;
    const saved = await saveConversationFile(
      {
        ...scope,
        conversationId: seeded.conversationId,
        fileId: seeded.fileId,
        expectedEtag: etag("1"),
        contentSha256: sha("user draft\n"),
        operationId: "active-run-edit",
        writerType: "user",
        writerId: scope.userId,
      },
      async () => {
        uploaded = true;
        return candidate("user draft\n", seeded.assetId);
      },
    );
    assert.equal(saved.sha256, sha("user draft\n"));
    assert.equal(saved.last_writer.type, "user");
    assert.equal(saved.last_writer.id, scope.userId);
    assert.equal(uploaded, true);
  });
});
