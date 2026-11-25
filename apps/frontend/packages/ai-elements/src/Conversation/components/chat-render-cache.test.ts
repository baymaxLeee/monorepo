import { expect, test, vi } from "vitest";

import { createSnapshotItemIndex, createSnapshotTailProjection } from "./chat-render-cache";

test("a stream projection only recomputes the SDK snapshot tail", () => {
  const extend = vi.fn((total: number, message: { value: number }) => total + message.value);
  const project = createSnapshotTailProjection(0, extend);
  const history = Array.from({ length: 100 }, (_, value) => ({ value }));

  expect(project(history)).toBe(4950);
  expect(extend).toHaveBeenCalledTimes(100);

  extend.mockClear();
  const delta = [...history.slice(0, -1), { value: 100 }];
  expect(project(delta)).toBe(4951);
  expect(extend).toHaveBeenCalledTimes(1);

  extend.mockClear();
  expect(project([...delta, { value: 101 }])).toBe(5052);
  expect(extend).toHaveBeenCalledTimes(1);
});

test("a stable message anchor avoids rescanning history", () => {
  const keyOf = vi.fn((message: { id: string }) => message.id);
  const findIndex = createSnapshotItemIndex(keyOf);
  const messages = Array.from({ length: 100 }, (_, index) => ({ id: `message-${index}` }));

  expect(findIndex(messages, "message-40")).toBe(40);
  keyOf.mockClear();
  expect(findIndex([...messages, { id: "message-100" }], "message-40")).toBe(40);
  expect(keyOf).toHaveBeenCalledTimes(1);
});
