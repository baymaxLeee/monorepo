import { beforeEach, expect, test } from "vitest";

import { useLocalWorkspaceStore } from "./useLocalWorkspaceStore";

beforeEach(() => useLocalWorkspaceStore.getState().reset());

test("keeps a dirty local workspace open until the draft is resolved", () => {
  const workspace = useLocalWorkspaceStore.getState();
  workspace.openWorkspace("thread", "src/first.ts");
  workspace.setDirty(true);
  workspace.requestClose();

  expect(useLocalWorkspaceStore.getState()).toMatchObject({
    open: true,
    path: "src/first.ts",
    dirty: true,
    closeBlocked: true,
  });

  useLocalWorkspaceStore.getState().setDirty(false);
  useLocalWorkspaceStore.getState().requestClose();
  expect(useLocalWorkspaceStore.getState()).toMatchObject({ open: false, threadId: null, path: null });
});

test("does not replace a dirty draft when another local file is opened", () => {
  const workspace = useLocalWorkspaceStore.getState();
  workspace.openWorkspace("thread", "src/first.ts");
  workspace.setDirty(true);
  workspace.openWorkspace("thread", "src/second.ts");

  expect(useLocalWorkspaceStore.getState()).toMatchObject({
    open: true,
    path: "src/first.ts",
    dirty: true,
    closeBlocked: true,
  });
});
