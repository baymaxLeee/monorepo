import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";

import { canvasnode } from "@/domain";

import { CancelCanvasNodeGeneration, StartCanvasNodeGeneration } from "../../domain/generations";
import { canvasNodesAtom } from "../../store";
import { useCanvasGeneration } from "./useCanvasGeneration";

vi.mock("../../domain/generations", () => ({
  StartCanvasNodeGeneration: vi.fn(),
  CancelCanvasNodeGeneration: vi.fn(),
}));
it("releases pending after a rejected command without writing formal state or leaking rejection", async () => {
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;
  const { result } = renderHook(() => useCanvasGeneration({ canvasId: "c", projectId: "p" }), { wrapper });
  const node = { NodeID: "n", Type: canvasnode.CanvasNodeType.TEXT_GENERATION } as canvasnode.CanvasNode;
  const before = store.get(canvasNodesAtom);
  vi.mocked(StartCanvasNodeGeneration).mockRejectedValueOnce(new Error("command rejected"));
  await act(async () => {
    await expect(result.current.generateNode(node)).resolves.toBeUndefined();
  });
  expect(result.current.textGenerationWaitingNodeIDs.size).toBe(0);
  vi.mocked(CancelCanvasNodeGeneration).mockRejectedValueOnce(new Error("cancel rejected"));
  await act(async () => {
    await expect(result.current.cancelNodeGeneration({ ...node, ActiveTaskRunID: "t" })).resolves.toBeUndefined();
  });
  expect(store.get(canvasNodesAtom)).toBe(before);
});
