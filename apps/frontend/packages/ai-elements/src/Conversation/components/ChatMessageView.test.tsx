import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DynamicToolUIPart } from "ai";
import { expect, test, vi } from "vitest";

import { ChatMessageView, type ChatMessageViewProps } from "./ChatMessageView";

vi.stubGlobal(
  "IntersectionObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const props: Omit<ChatMessageViewProps, "message"> = {
  conversationId: "conversation",
  streaming: true,
  documents: new Map(),
  latestTodoCallId: null,
  deliverableCompletion: { artifact: [], image: [], video: [] },
  onOpenArtifact: vi.fn(),
  onOpenFile: vi.fn(),
  onOpenWorkspaceFile: vi.fn(),
  onAnswerClientTool: vi.fn(),
  onToolApproval: vi.fn(),
  onExecutePlan: vi.fn(),
  planExecutedIds: new Set(),
  planBusy: false,
};

function message(part: DynamicToolUIPart) {
  return <ChatMessageView {...props} message={{ id: "message", role: "assistant", parts: [part] }} />;
}

const running: DynamicToolUIPart = {
  type: "dynamic-tool",
  toolName: "fetch",
  toolCallId: "tool",
  state: "input-available",
  input: { query: "raw-input" },
};

test("generic tool details stay collapsed while running and after completion", async () => {
  const view = render(message(running));
  expect((await screen.findByRole("button", { name: /fetch\s*执行中/ })).getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText(/raw-input/)).toBeNull();

  view.rerender(message({ ...running, state: "output-available", output: { result: "raw-output" } }));
  const trigger = screen.getByRole("button", { name: /fetch\s*已完成/ });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText(/raw-output/)).toBeNull();
  fireEvent.click(trigger);
  expect(screen.getByText(/raw-input/)).toBeTruthy();
  expect(screen.getByText(/raw-output/)).toBeTruthy();
});

test("stream updates preserve a user's expanded tool details", async () => {
  const view = render(message(running));
  fireEvent.click(await screen.findByRole("button", { name: /fetch\s*执行中/ }));
  view.rerender(message({ ...running, state: "output-available", output: "raw-output" }));
  expect(screen.getByRole("button", { name: /fetch\s*已完成/ }).getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText("raw-output")).toBeTruthy();
});

test("required approval stays visible and actionable", async () => {
  render(message({ ...running, state: "approval-requested", approval: { id: "approval" } }));
  fireEvent.click(await screen.findByRole("button", { name: "允许" }));
  expect(props.onToolApproval).toHaveBeenCalledWith("approval", true);
});

test("tool failure surfaces its reason without an extra click", async () => {
  render(message({ ...running, state: "output-error", errorText: "连接超时" }));
  expect(await screen.findByText("连接超时")).toBeTruthy();
  expect(screen.getByRole("button", { name: /fetch\s*失败/ }).getAttribute("aria-expanded")).toBe("true");
});

test("structured tool failures drive the native header state", async () => {
  render(
    message({
      ...running,
      state: "output-available",
      output: {
        ok: false,
        status: "failed",
        error: { code: "provider_failed", message: "上游服务失败", retryable: true },
      },
    }),
  );
  expect(await screen.findByText("上游服务失败")).toBeTruthy();
  expect(screen.getByRole("button", { name: /fetch\s*失败/ }).getAttribute("aria-expanded")).toBe("true");
  expect(screen.queryByRole("button", { name: /fetch\s*已完成/ })).toBeNull();
});

test("persistent file data replaces the cloud upload tool and opens a local workspace file", () => {
  const fileId = "a".repeat(32);
  render(
    <ChatMessageView
      {...props}
      message={{
        id: "message",
        role: "assistant",
        parts: [
          {
            type: "tool-upload_artifacts",
            toolCallId: "save",
            state: "output-available",
            input: {},
            toolMetadata: { agent: { uiKind: "artifact" } },
            output: {
              ok: true,
              status: "completed",
              data: {
                files: [
                  {
                    file_id: fileId,
                    filename: "demo.js",
                    title: "demo.js",
                    media_type: "text/javascript",
                    kind: "artifact",
                    etag: `"${"b".repeat(32)}"`,
                    updated: false,
                  },
                ],
              },
            },
          },
          {
            type: "data-file",
            id: fileId,
            data: {
              file_id: fileId,
              filename: "demo.js",
              title: "demo.js",
              media_type: "text/javascript",
              kind: "artifact",
              etag: `"${"b".repeat(32)}"`,
              updated: false,
              workspace_path: "src/demo.js",
            },
          },
        ],
      }}
    />,
  );
  expect(screen.getAllByText("demo.js")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "打开文件 demo.js" }));
  expect(props.onOpenWorkspaceFile).toHaveBeenCalledWith("src/demo.js");
});

test("cloud file data opens the durable conversation file", () => {
  const fileId = "c".repeat(32);
  render(
    <ChatMessageView
      {...props}
      message={{
        id: "message",
        role: "assistant",
        parts: [
          {
            type: "data-file",
            id: fileId,
            data: {
              file_id: fileId,
              filename: "report.md",
              title: "Report",
              media_type: "text/markdown",
              kind: "artifact",
              etag: `"${"d".repeat(32)}"`,
              updated: false,
            },
          },
        ],
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "打开文件 Report" }));
  expect(props.onOpenFile).toHaveBeenCalledWith(fileId);
});

test("reasoning files stay in a separate disclosure instead of becoming final attachments", () => {
  render(
    <ChatMessageView
      {...props}
      streaming={false}
      message={{
        id: "message",
        role: "assistant",
        parts: [
          {
            type: "reasoning-file",
            mediaType: "application/pdf",
            url: "/api/chat-server/conversations/conversation/documents/reasoning/content?document_id=reasoning",
          },
        ],
      }}
    />,
  );
  expect(screen.getByRole("button", { name: "推理附件" })).toBeTruthy();
  expect(screen.queryByText("思考过程")).toBeNull();
});

test("message actions use explicit edit, regenerate, and server branch operations", async () => {
  const onEditMessage = vi.fn(async () => {});
  const onRegenerate = vi.fn(async () => {});
  const onSelectBranch = vi.fn(async () => {});
  const view = render(
    <ChatMessageView
      {...props}
      streaming={false}
      message={{ id: "user", role: "user", parts: [{ type: "text", text: "旧问题" }] }}
      onEditMessage={onEditMessage}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "编辑消息" }));
  fireEvent.change(screen.getByRole("textbox", { name: "编辑消息" }), { target: { value: "新问题" } });
  fireEvent.click(screen.getByRole("button", { name: "保存并重新生成" }));
  await waitFor(() => expect(onEditMessage).toHaveBeenCalledWith("user", [{ type: "text", text: "新问题" }]));

  view.rerender(
    <ChatMessageView
      {...props}
      streaming={false}
      message={{ id: "assistant-b", role: "assistant", parts: [{ type: "text", text: "候选 B" }] }}
      branch={{
        parent_message_id: "user",
        selected_message_id: "assistant-b",
        candidates: [
          { message_id: "assistant-a", leaf_message_id: "leaf-a", role: "assistant", created_at: "2026-01-01" },
          { message_id: "assistant-b", leaf_message_id: "leaf-b", role: "assistant", created_at: "2026-01-02" },
        ],
      }}
      onRegenerate={onRegenerate}
      onSelectBranch={onSelectBranch}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "重新生成" }));
  await waitFor(() => expect(onRegenerate).toHaveBeenCalledWith("assistant-b"));
  fireEvent.click(screen.getByRole("button", { name: "上一个分支" }));
  await waitFor(() => expect(onSelectBranch).toHaveBeenCalledWith("leaf-a"));
});

test("native tool title and preliminary output remain visibly in progress", async () => {
  const part: DynamicToolUIPart = {
    ...running,
    title: "读取证据",
    state: "output-available",
    output: { progress: 1 },
    preliminary: true,
  };
  const view = render(message(part));
  expect(await screen.findByRole("button", { name: /读取证据\s*执行中/ })).toBeTruthy();
  expect(screen.queryByText("已完成")).toBeNull();
  view.rerender(message({ ...part, preliminary: false }));
  expect(screen.getByRole("button", { name: /读取证据\s*已完成/ })).toBeTruthy();
});
