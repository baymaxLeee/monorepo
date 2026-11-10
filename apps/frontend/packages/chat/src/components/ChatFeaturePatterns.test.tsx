import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { UIMessage } from "ai";
import { expect, test, vi } from "vitest";

import { ChatCheckpoint } from "./ChatCheckpoint";
import { ChatCitedResponse } from "./ChatCitedResponse";
import { ChatFileTree } from "./ChatFileTree";
import { collectDeliverableCompletion } from "./ChatTodoListCard";

for (const [text, startIndex, endIndex] of [
  ["First.\n\nSecond paragraph.", 0, 5],
  ["First paragraph.\n\nSecond.", 18, 24],
] as const) {
  test(`native citations use full-message offsets across Markdown blocks: ${startIndex}`, () => {
    render(
      <ChatCitedResponse
        text={text}
        streaming={false}
        sources={[]}
        citations={[
          {
            source: {
              type: "source",
              sourceType: "url",
              id: "evidence",
              url: "https://example.com/evidence",
              title: "Evidence",
            },
            startIndex,
            endIndex,
          },
        ]}
      />,
    );
    expect(screen.queryAllByRole("link", { name: "引用：Evidence" })).toHaveLength(1);
  });
}

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
test("native citations render without a separate source part and preserve emoji and Markdown", () => {
  const text = "😀 **结论** 与 [指南](https://example.com/guide)";
  render(
    <ChatCitedResponse
      streaming={false}
      text={text}
      sources={[]}
      citations={[
        {
          source: {
            type: "source",
            sourceType: "url",
            id: "evidence",
            url: "https://example.com/evidence?query=ui#result",
            title: "Evidence",
          },
          startIndex: 0,
          endIndex: 2,
          citedText: "😀",
        },
        {
          source: {
            type: "source",
            sourceType: "url",
            id: "evidence",
            url: "https://example.com/evidence?query=ui#result",
            title: "Evidence",
          },
          startIndex: 3,
          endIndex: 9,
          citedText: "结论",
        },
      ]}
    />,
  );

  expect(document.body.textContent).toContain("😀");
  expect(screen.getByText("结论").getAttribute("data-streamdown")).toBe("strong");
  expect(screen.getByRole("link", { name: "指南" }).getAttribute("href")).toBe("https://example.com/guide");
  const citations = screen.getAllByRole("link", { name: "引用：Evidence" });
  expect(citations).toHaveLength(2);
  expect(citations[0].getAttribute("href")).toBe("https://example.com/evidence?query=ui#result");
});
test("document citations use the application resolver and unpositioned evidence remains visible", () => {
  render(
    <ChatCitedResponse
      streaming={false}
      text="结论"
      sources={[]}
      resolveSourceHref={(source) => {
        const value = source as Record<string, unknown>;
        return value.sourceId === "document" ? "/api/chat-server/conversations/c/sources/document/content" : undefined;
      }}
      citations={[
        {
          source: {
            type: "source",
            sourceType: "document",
            id: "document",
            mediaType: "application/pdf",
            title: "内部文档",
            filename: "internal.pdf",
          },
          citedText: "证据原文",
        },
      ]}
    />,
  );
  expect(screen.getByRole("link", { name: "引用：内部文档" }).getAttribute("href")).toBe(
    "/api/chat-server/conversations/c/sources/document/content",
  );
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
