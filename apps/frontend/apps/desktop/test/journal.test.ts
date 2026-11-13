import { chmod, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, it } from "vitest";

import type { LocalThread } from "../contracts/bridge.generated";
import { LocalJournal } from "../electron/journal";

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

function thread(id: string, updatedAt: string, title: string): LocalThread {
  return {
    id,
    mode: "local",
    title,
    workspace: "/project",
    agentId: null,
    status: "idle",
    turnId: null,
    error: null,
    updatedAt,
    pendingInputs: [],
    messages: [{ id: `${id}-message`, role: "user", parts: [{ type: "text", text: title }] }],
  };
}

it("imports all legacy journals once and keeps the newest copy of a thread", async () => {
  const root = await mkdtemp(join(tmpdir(), "journal-migration-"));
  directories.push(root);
  const firstDirectory = join(root, "desktop", "scope");
  const secondDirectory = join(root, "monorepo-desktop", "scope");
  const targetDirectory = join(root, "runtime", "sessions", "scope");
  const sharedId = "11111111-1111-4111-8111-111111111111";

  const first = new LocalJournal(firstDirectory);
  first.save(thread(sharedId, "2026-01-01T00:00:00.000Z", "old"));
  first.save(thread("22222222-2222-4222-8222-222222222222", "2026-01-02T00:00:00.000Z", "first"));
  first.close();
  const second = new LocalJournal(secondDirectory);
  second.save(thread(sharedId, "2026-01-03T00:00:00.000Z", "new"));
  second.close();

  await mkdir(targetDirectory, { recursive: true });
  await chmod(targetDirectory, 0o755);
  const target = new LocalJournal(targetDirectory, [firstDirectory, secondDirectory]);
  expect((await stat(targetDirectory)).mode & 0o777).toBe(0o700);
  expect(target.list()).toHaveLength(2);
  expect(target.get(sharedId).title).toBe("new");
  expect(target.get(sharedId).messages[0]?.parts).toEqual([{ type: "text", text: "new" }]);
  target.remove(sharedId);
  target.close();

  const reopened = new LocalJournal(targetDirectory, [firstDirectory, secondDirectory]);
  expect(() => reopened.get(sharedId)).toThrow("本地会话不存在");
  expect(reopened.list()).toHaveLength(1);
  reopened.close();
});
