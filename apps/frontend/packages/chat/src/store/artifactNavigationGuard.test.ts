import { afterEach, expect, it, vi } from "vitest";

import { registerArtifactNavigationGuard } from "./artifactNavigationGuard";
import { useChatStore } from "./useChatStore";

let unregister: (() => void) | undefined;
afterEach(() => {
  unregister?.();
});

it("every mutually exclusive workspace respects a dirty file guard", async () => {
  const guard = vi.fn(async () => false);
  unregister = registerArtifactNavigationGuard(guard);
  const actions = [
    () => useChatStore.getState().setMemoryPanelOpen(true),
    () => useChatStore.getState().openTracePanel("c"),
    () => useChatStore.getState().setTracePanelOpen(true),
    () => useChatStore.getState().openVideoProductionWorkspace("c", "p"),
  ];
  for (const action of actions) {
    useChatStore.setState({
      artifactPreview: { open: true, conversationId: "c", fileId: "f", documentId: null, token: 1 },
    });
    action();
    await Promise.resolve();
    await Promise.resolve();
    expect(useChatStore.getState().artifactPreview.fileId).toBe("f");
  }
  expect(guard).toHaveBeenCalledTimes(actions.length);
});
