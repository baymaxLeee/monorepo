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
  onOpenArtifact: vi.fn(),
  onOpenFile: vi.fn(),
  onOpenWorkspaceFile: vi.fn(),
  onAnswerClientTool: vi.fn(),
  onToolApproval: vi.fn(),
  busy: false,
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

test("a running tool opens and closes when it completes", async () => {
  const view = render(message(running));
  expect((await screen.findByRole("button", { name: /fetch\s*执行中/ })).getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText(/raw-input/)).toBeTruthy();

  view.rerender(message({ ...running, state: "output-available", output: { result: "raw-output" } }));
  const trigger = screen.getByRole("button", { name: /fetch\s*已完成/ });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText(/raw-output/)).toBeNull();
  fireEvent.click(trigger);
  expect(screen.getByText(/raw-input/)).toBeTruthy();
  expect(screen.getByText(/raw-output/)).toBeTruthy();
});

test("preliminary terminal output remains open until the tool reaches a final state", async () => {
  const preliminary: DynamicToolUIPart = {
    ...running,
    toolName: "bash",
    state: "output-available",
    preliminary: true,
    input: { cmd: "test" },
    output: { output: "partial" },
    toolMetadata: { agent: { uiKind: "terminal" } },
  };
  const view = render(message(preliminary));
  const trigger = await screen.findByRole("button", { name: /test.*运行中/ });
  expect(trigger.getAttribute("aria-expanded")).toBe("true");

  view.rerender(message({ ...preliminary, preliminary: false, output: { output: "done", exit_code: 0 } }));
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

test("each running tool opens from its own lifecycle state", async () => {
  const view = render(
    <ChatMessageView
      {...props}
      message={{
        id: "message",
        role: "assistant",
        parts: [{ ...running, toolCallId: "older", input: { query: "older-input" } }],
      }}
    />,
  );
  expect((await screen.findByRole("button", { name: /fetch\s*执行中/ })).getAttribute("aria-expanded")).toBe("true");

  view.rerender(
    <ChatMessageView
      {...props}
      message={{
        id: "message",
        role: "assistant",
        parts: [
          { ...running, toolCallId: "older", input: { query: "older-input" } },
          { ...running, toolCallId: "newer", input: { query: "newer-input" } },
        ],
      }}
    />,
  );

  const triggers = await screen.findAllByRole("button", { name: /fetch\s*执行中/ });
  expect(triggers[0]?.getAttribute("aria-expanded")).toBe("true");
  expect(triggers[1]?.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText(/older-input/)).toBeTruthy();
  expect(screen.getByText(/newer-input/)).toBeTruthy();
});

test("completion closes a tool even after a user opened it", async () => {
  const view = render(message(running));
  const runningTrigger = await screen.findByRole("button", { name: /fetch\s*执行中/ });
  fireEvent.click(runningTrigger);
  fireEvent.click(runningTrigger);
  view.rerender(message({ ...running, state: "output-available", output: "raw-output" }));
  const completedTrigger = screen.getByRole("button", { name: /fetch\s*已完成/ });
  expect(completedTrigger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(completedTrigger);
  expect(screen.getByText("raw-output")).toBeTruthy();
});

test("required approval stays visible and actionable", async () => {
  render(message({ ...running, state: "approval-requested", approval: { id: "approval" } }));
  fireEvent.click(await screen.findByRole("button", { name: "允许" }));
  expect(props.onToolApproval).toHaveBeenCalledWith("approval", true);
});

test("tool failure stays collapsed until the user inspects it", async () => {
  render(message({ ...running, state: "output-error", errorText: "连接超时" }));
  const trigger = await screen.findByRole("button", { name: /fetch\s*失败/ });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("连接超时")).toBeNull();
  fireEvent.click(trigger);
  expect(screen.getByText("连接超时")).toBeTruthy();
});

test("durable message failure remains visible after the live stream is gone", () => {
  render(
    <ChatMessageView
      {...props}
      streaming={false}
      message={{
        id: "failed-message",
        role: "assistant",
        parts: [],
        metadata: {
          runId: "failed-run",
          providerId: "provider",
          model: "model",
          status: "failed",
          historyRevision: 3,
        },
      }}
    />,
  );

  expect(screen.getByRole("alert").textContent).toContain("本次生成失败");
});

test("tool metadata cannot hide a tool call", async () => {
  render(
    message({
      ...running,
      toolName: "previously_internal",
      toolMetadata: { agent: { visibility: "internal" } },
    }),
  );
  expect(await screen.findByRole("button", { name: /previously_internal\s*执行中/ })).toBeTruthy();
});

test("successful todo snapshots leave the transcript while approval remains actionable", async () => {
  render(
    <ChatMessageView
      {...props}
      message={{
        id: "message",
        role: "assistant",
        parts: [
          {
            type: "tool-update_plan",
            toolCallId: "older-todo",
            state: "output-available",
            input: {},
            toolMetadata: { agent: { uiKind: "todo-list" } },
            output: {
              ok: true,
              status: "completed",
              data: { plan: [{ step: "旧计划", status: "completed" }] },
            },
          },
          {
            type: "tool-update_plan",
            toolCallId: "newer-todo",
            state: "output-available",
            input: {},
            toolMetadata: { agent: { uiKind: "todo-list" } },
            output: {
              ok: true,
              status: "completed",
              data: { plan: [{ step: "新计划", status: "completed" }] },
            },
          },
          {
            type: "tool-update_plan",
            toolCallId: "awaiting-approval",
            state: "approval-requested",
            input: {},
            toolMetadata: { agent: { uiKind: "todo-list" } },
            approval: { id: "todo-approval" },
          },
        ],
      }}
    />,
  );
  expect(screen.queryByText("新计划")).toBeNull();
  expect(screen.queryByText("旧计划")).toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: "允许" }));
  expect(props.onToolApproval).toHaveBeenCalledWith("todo-approval", true);
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
  const trigger = await screen.findByRole("button", { name: /fetch\s*失败/ });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("上游服务失败")).toBeNull();
  fireEvent.click(trigger);
  expect(screen.getByText("上游服务失败")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /fetch\s*已完成/ })).toBeNull();
});

test("cloud upload stays observable beside the persistent local file tag", () => {
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
  expect(screen.getByRole("button", { name: /upload_artifacts\s*已完成/ })).toBeTruthy();
  expect(screen.getAllByText("demo.js")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "打开文件 demo.js" }));
  expect(props.onOpenWorkspaceFile).toHaveBeenCalledWith("src/demo.js");
});

test("artifact metadata never replaces the observable tool shell with a preview card", () => {
  render(
    message({
      ...running,
      toolName: "publish_artifact",
      state: "output-available",
      toolMetadata: { agent: { uiKind: "artifact" } },
      output: {
        ok: true,
        status: "completed",
        data: { document_id: "document", filename: "report.md", title: "Report" },
      },
    }),
  );
  expect(screen.getByRole("button", { name: /publish_artifact\s*已完成/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "预览" })).toBeNull();
});

test("cloud file data opens the durable conversation file", () => {
  const fileId = "c".repeat(32);
  render(
    <ChatMessageView
      {...props}
      onOpenWorkspaceFile={undefined}
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
              workspace_path: "/workspace/report.md",
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

test("an automatic rejection explains why the tool could not execute", async () => {
  render(
    message({
      ...running,
      state: "output-denied",
      approval: {
        id: "decision",
        approved: false,
        isAutomatic: true,
        reason: "patch hunk must contain a change",
      },
    }),
  );
  const trigger = screen.getByRole("button", { name: /fetch.*已拒绝/ });
  if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
  expect(await screen.findByText("patch hunk must contain a change")).toBeTruthy();
  expect(screen.getByText("工具调用被自动拒绝。")).toBeTruthy();
});
