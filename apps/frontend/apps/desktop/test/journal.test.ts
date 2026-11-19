import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { COMPACTION_STATE_VERSION } from "@repo/agent-runtime/context/compaction";
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
    approvalMode: "auto",
    status: "idle",
    turnId: "33333333-3333-4333-8333-333333333333",
    error: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    pendingInputs: [],
    messages: [{ id: `${id}-message`, role: "user", parts: [{ type: "text", text: title }] }],
  };
}

it("persists one append-only thread rollout in the kernel database", async () => {
  const directory = await mkdtemp(join(tmpdir(), "runtime-journal-"));
  directories.push(directory);
  const id = "11111111-1111-4111-8111-111111111111";
  const journal = new LocalJournal(directory);
  const value = thread(id, "first");
  journal.save(value);
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
  journal.close();
});
