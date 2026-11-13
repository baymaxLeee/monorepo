import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { UIMessage } from "ai";
import { expect, test, vi } from "vitest";

import { ChatCheckpoint } from "./ChatCheckpoint";
import { ChatCitedResponse } from "./ChatCitedResponse";
import { ChatComposerControls } from "./ChatComposerControls";
import { collectDeliverableCompletion } from "./ChatTodoListCard";

test("shared composer controls keep a non-interactive local agent visually aligned", () => {
  render(<ChatComposerControls agents={[{ id: "local", name: "baymax" }]} selectedAgentId="local" mode="normal" />);

  expect(screen.getByText("Agent")).toBeTruthy();
  expect(screen.getByText("baymax")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

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
test("native citations do not duplicate explicit URL fallback citations", () => {
  const url = "https://example.com/evidence";
  render(
    <ChatCitedResponse
      streaming={false}
      text={`[Evidence](${url})`}
      sources={[{ type: "source-url", sourceId: "evidence", url, title: "Evidence" }]}
      citations={[
        {
          source: { type: "source", sourceType: "url", id: "evidence", url, title: "Evidence" },
          startIndex: 1,
          endIndex: 9,
        },
      ]}
    />,
  );
  expect(screen.getAllByRole("link", { name: "引用：Evidence" })).toHaveLength(1);
  expect(screen.getByRole("link", { name: "Evidence" }).getAttribute("href")).toBe(url);
});

test("positioned and unpositioned native citations keep one global numbering sequence", () => {
  render(
    <ChatCitedResponse
      streaming={false}
      text="证据"
      sources={[]}
      citations={[
        {
          source: {
            type: "source",
            sourceType: "url",
            id: "positioned",
            url: "https://example.com/positioned",
            title: "Positioned",
          },
          startIndex: 0,
          endIndex: 2,
        },
        {
          source: {
            type: "source",
            sourceType: "url",
            id: "unpositioned",
            url: "https://example.com/unpositioned",
            title: "Unpositioned",
          },
        },
      ]}
    />,
  );
  expect(screen.getByRole("link", { name: "引用：Positioned" }).textContent).toMatch(/^1/);
  expect(screen.getByRole("link", { name: "引用：Unpositioned" }).textContent).toMatch(/^2/);
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
test.each(["completed", "running", "failed"] as const)(
  "sandbox publication %s settles the associated artifact todo from real outcomes",
  (status) => {
    const messages: UIMessage[] = [
      {
        id: "reply",
        role: "assistant",
        parts: [
          { type: "tool-update_todos", toolCallId: "todo", state: "output-available", input: {}, output: {} },
          {
            type: "tool-upload_artifacts",
            toolCallId: "save",
            state: "output-available",
            input: {},
            toolMetadata: { agent: { uiKind: "artifact" } },
            output:
              status === "failed"
                ? { ok: false, status, error: { code: "failed", message: "failed", retryable: false } }
                : status === "running"
                  ? { ok: true, status, progress: { done: 1, total: 2 } }
                  : { ok: true, status, data: { files: [{ file_id: "file", filename: "report.md" }] } },
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
