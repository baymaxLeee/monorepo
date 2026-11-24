import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { COMPACTION_STATE_VERSION, type ResolvedTurnPluginSnapshot } from "@repo/agent-runtime";
import { afterEach, expect, it } from "vitest";

import type { LocalThread } from "../contracts/bridge.generated";
import { LocalJournal } from "../electron/runtime/journal";

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

function thread(id: string, title: string): LocalThread {
  return {
    id,
    mode: "local",
    title,
    workspace: "/project",
    providerId: "provider",
    reasoningEffort: "medium",
    approvalPolicy: "on-request",
    permissionProfile: ":workspace",
    pluginActivations: [],
    status: "idle",
    turnId: "33333333-3333-4333-8333-333333333333",
    error: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    pendingInputs: [],
    contextUsage: null,
    messages: [{ id: `${id}-message`, role: "user", parts: [{ type: "text", text: title }] }],
  };
}

function replaceMetadata(directory: string, id: string, update: (value: Record<string, unknown>) => void): void {
  const database = new DatabaseSync(join(directory, "runtime-v2.sqlite"));
  const row = database.prepare("SELECT metadata FROM threads WHERE id=?").get(id);
  if (!row) throw new Error("missing test thread");
  const metadata = JSON.parse(String(row.metadata)) as Record<string, unknown>;
  update(metadata);
  database.prepare("UPDATE threads SET metadata=? WHERE id=?").run(JSON.stringify(metadata), id);
  database.close();
}

function pluginSnapshot(): ResolvedTurnPluginSnapshot {
  return {
    schemaVersion: 1,
    snapshotId: "snapshot-1",
    snapshotDigest: `sha256:${"1".repeat(64)}`,
    plugins: [],
    connectionGrants: [
      {
        pluginId: "knowledge@platform",
        serverName: "knowledge",
        headers: { Authorization: "Bearer secret" },
      },
    ],
  };
}

it("persists one append-only thread rollout in the kernel database", async () => {
  const directory = await mkdtemp(join(tmpdir(), "runtime-journal-"));
  directories.push(directory);
  const id = "11111111-1111-4111-8111-111111111111";
  const journal = new LocalJournal(directory);
  const value = thread(id, "first");
  journal.save(value);

  const database = new DatabaseSync(join(directory, "runtime-v2.sqlite"));
  const tables = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((row) => String(row.name));
  expect(tables).toContain("thread_turns");
  expect(tables).not.toContain("turns");
  expect(database.prepare("PRAGMA user_version").get()?.user_version).toBe(2);
  database.close();
  value.messages.push({ id: `${id}-assistant`, role: "assistant", parts: [{ type: "text", text: "done" }] });
  journal.save(value);

  expect((await stat(directory)).mode & 0o777).toBe(0o700);
  expect(journal.list()).toHaveLength(1);
  expect(journal.get(id).messages).toHaveLength(2);
  expect(() => journal.save({ ...value, messages: value.messages.slice(1) })).toThrow("append-only");
  journal.close();

  const reopened = new LocalJournal(directory);
  expect(reopened.get(id).messages[1]?.parts).toEqual([{ type: "text", text: "done" }]);
  reopened.remove(id);
  expect(() => reopened.get(id)).toThrow("本地会话不存在");
  reopened.close();
});

it("installs context checkpoints with revision fencing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "runtime-checkpoint-"));
  directories.push(directory);
  const id = "22222222-2222-4222-8222-222222222222";
  const journal = new LocalJournal(directory);
  journal.save(thread(id, "context"));
  journal.saveCheckpoint(id, {
    expectedRevision: null,
    coveredThroughMessageId: `${id}-message`,
    state: { version: COMPACTION_STATE_VERSION, summary: "durable facts" },
    estimatedTokens: 4,
  });
  expect(journal.getCheckpoint(id)).toMatchObject({ revision: 1, state: { summary: "durable facts" } });
  expect(() =>
    journal.saveCheckpoint(id, {
      expectedRevision: 0,
      coveredThroughMessageId: `${id}-message`,
      state: { version: COMPACTION_STATE_VERSION, summary: "stale" },
      estimatedTokens: 1,
    }),
  ).toThrow("revision conflict");
  const step = {
    version: "step-compaction-v1" as const,
    assistantId: "assistant",
    toolCallIds: ["read-1"],
    retainUser: true,
    compacted: { version: COMPACTION_STATE_VERSION, summary: "step evidence" },
  };
  journal.saveCheckpoint(id, {
    expectedRevision: 1,
    coveredThroughMessageId: `${id}-message`,
    state: step,
    estimatedTokens: 4,
  });
  journal.close();
  const reopened = new LocalJournal(directory);
  try {
    expect(reopened.getCheckpoint(id)).toMatchObject({ revision: 2, state: step });
  } finally {
    reopened.close();
  }
});

it("persists context usage and treats missing legacy usage as unknown", async () => {
  const directory = await mkdtemp(join(tmpdir(), "runtime-context-usage-"));
  directories.push(directory);
  const id = "66666666-6666-4666-8666-666666666666";
  const journal = new LocalJournal(directory);
  const value = thread(id, "usage");
  value.contextUsage = {
    contextWindow: 128_000,
    autoCompactAt: 89_600,
    usedTokens: 42_000,
    estimated: false,
    compacted: true,
    categories: [{ id: "conversation", tokens: 42_000 }],
  };
  journal.save(value);

  expect(journal.get(id).contextUsage).toEqual(value.contextUsage);
  journal.close();

  replaceMetadata(directory, id, (metadata) => {
    delete metadata.contextUsage;
  });
  const legacy = new LocalJournal(directory);
  expect(legacy.get(id).contextUsage).toBeNull();
  legacy.close();
});

it("rejects legacy or incomplete execution policy metadata without migration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "runtime-policy-metadata-"));
  directories.push(directory);
  const id = "55555555-5555-4555-8555-555555555555";
  const journal = new LocalJournal(directory);
  journal.save(thread(id, "policy"));
  journal.close();

  replaceMetadata(directory, id, (metadata) => {
    delete metadata.approvalPolicy;
    metadata.approvalMode = "auto";
  });
  const legacy = new LocalJournal(directory);
  expect(() => legacy.list()).toThrow("已移除的 approvalMode");
  expect(() => legacy.get(id)).toThrow("已移除的 approvalMode");
  legacy.close();

  replaceMetadata(directory, id, (metadata) => {
    delete metadata.approvalMode;
    metadata.approvalPolicy = "on-request";
    delete metadata.permissionProfile;
  });
  const incomplete = new LocalJournal(directory);
  expect(() => incomplete.list()).toThrow("permissionProfile");
  expect(() => incomplete.get(id)).toThrow("permissionProfile");
  incomplete.close();
});

it("persists an immutable Turn plugin snapshot without connection grants", async () => {
  const directory = await mkdtemp(join(tmpdir(), "runtime-plugin-snapshot-"));
  directories.push(directory);
  const id = "44444444-4444-4444-8444-444444444444";
  const journal = new LocalJournal(directory);
  const value = thread(id, "plugins");
  journal.save(value);
  const snapshot = pluginSnapshot();

  journal.savePluginSnapshot(value.turnId!, snapshot);
  journal.savePluginSnapshot(value.turnId!, snapshot);

  const persisted = journal.getPluginSnapshot(value.turnId!);
  expect(persisted).toMatchObject({ snapshotId: "snapshot-1", snapshotDigest: snapshot.snapshotDigest });
  expect(JSON.stringify(persisted)).not.toContain("Authorization");
  expect(JSON.stringify(persisted)).not.toContain("Bearer secret");
  expect(() =>
    journal.savePluginSnapshot(value.turnId!, {
      ...snapshot,
      snapshotId: "snapshot-2",
      snapshotDigest: `sha256:${"2".repeat(64)}`,
    }),
  ).toThrow("immutable");
  journal.close();
});
