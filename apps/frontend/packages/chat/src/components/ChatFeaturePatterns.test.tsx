import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { UIMessage } from "ai";
import { expect, test, vi } from "vitest";

import { ChatCheckpoint } from "./ChatCheckpoint";
import { ChatCitedResponse } from "./ChatCitedResponse";
import { ChatFileTree } from "./ChatFileTree";
import { collectDeliverableCompletion } from "./ChatTodoListCard";

test("citations match explicit source URLs without inventing references", () => {
  render(
    <ChatCitedResponse
      streaming={false}
      text="根据[文档](https://example.com/doc)，也可读[其他](https://example.com/other)。"
      sources={[{ type: "source-url", sourceId: "doc", url: "https://example.com/doc", title: "官方文档" }]}
    />,
  );
  expect(screen.getByRole("link", { name: /文档/ }).getAttribute("href")).toBe("https://example.com/doc");
  expect(screen.getByRole("link", { name: "其他" }).getAttribute("href")).toBe("https://example.com/other");
  expect(screen.queryByText("2")).toBeNull();
});
test("file tree opens frozen source snapshots through document ownership", () => {
  const openFile = vi.fn();
  const openDocument = vi.fn();
  render(
    <ChatFileTree
      files={[{ path: "documents/snapshot", title: "引用文件" }, { path: "src/main.ts" }]}
      onOpenFile={openFile}
      onOpenArtifact={openDocument}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "引用文件" }));
  expect(openDocument).toHaveBeenCalledWith("snapshot");
  fireEvent.click(screen.getByRole("button", { name: "main.ts" }));
  expect(openFile).toHaveBeenCalledWith("src/main.ts");
});
test.each(["completed", "running", "failed"] as const)(
  "subagent %s settles the associated artifact todo from real outcomes",
  (status) => {
    const messages: UIMessage[] = [
      {
        id: "reply",
        role: "assistant",
        parts: [
          { type: "tool-update_todos", toolCallId: "todo", state: "output-available", input: {}, output: {} },
          {
            type: "tool-delegate_tasks",
            toolCallId: "batch",
            state: "output-available",
            input: {},
            toolMetadata: { agent: { uiKind: "subagent" } },
            output:
              status === "failed"
                ? { ok: false, status, error: { code: "failed", message: "failed", retryable: false } }
                : status === "running"
                  ? { ok: true, status, progress: { done: 1, total: 2 } }
                  : { ok: true, status, data: { paths: ["a", "b"] } },
          },
        ],
      },
    ];
    expect(collectDeliverableCompletion(messages, "todo").artifact).toEqual([status === "failed" ? "error" : status]);
  },
);
test("checkpoint prevents duplicate requests and preserves retry after failure", async () => {
  let reject: (error: Error) => void = () => {};
  const fork = vi.fn(
    () =>
      new Promise<void>((_resolve, rejectPromise) => {
        reject = rejectPromise;
      }),
  );
  render(<ChatCheckpoint messageId="reply" disabled={false} onFork={fork} />);
  const button = screen.getByRole("button", { name: "从此处创建分支" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(fork).toHaveBeenCalledTimes(1);
  reject(new Error("网络不可用"));
  await screen.findByRole("alert");
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  expect(screen.getByRole("alert").textContent).toContain("网络不可用");
});
