import { registerArtifactNavigationGuard } from "@repo/ai-elements/conversation/store/artifactNavigationGuard";
import { beforeEach, expect, test, vi } from "vitest";

import { useLocalWorkspaceStore } from "./useLocalWorkspaceStore";

beforeEach(() => useLocalWorkspaceStore.getState().reset());

test("opens and closes the local workspace after navigation is allowed", async () => {
  const workspace = useLocalWorkspaceStore.getState();
  workspace.openWorkspace("thread", "src/first.ts");
  await vi.waitFor(() => expect(useLocalWorkspaceStore.getState().path).toBe("src/first.ts"));

  workspace.requestClose();
  await vi.waitFor(() => expect(useLocalWorkspaceStore.getState()).toMatchObject({ open: false, path: null }));
});

test("preserves the selected local file when the shared editor blocks navigation", async () => {
  const workspace = useLocalWorkspaceStore.getState();
  workspace.openWorkspace("thread", "src/first.ts");
  await vi.waitFor(() => expect(useLocalWorkspaceStore.getState().path).toBe("src/first.ts"));
  const guard = vi.fn(async () => false);
  const unregister = registerArtifactNavigationGuard(guard);

  workspace.openWorkspace("thread", "src/second.ts");
  await vi.waitFor(() => expect(guard).toHaveBeenCalledOnce());

  expect(useLocalWorkspaceStore.getState()).toMatchObject({ open: true, path: "src/first.ts" });
  unregister();
});
