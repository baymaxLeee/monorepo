import { fireEvent, render, screen } from "@testing-library/react";
import type { DynamicToolUIPart } from "ai";
import { expect, test, vi } from "vitest";

import { ChatMessageView, type ChatMessageViewProps } from "./ChatMessageView";

const props: Omit<ChatMessageViewProps, "message"> = {
  conversationId: "conversation",
  streaming: true,
  documents: new Map(),
  latestTodoCallId: null,
  deliverableCompletion: { artifact: [], image: [], video: [] },
  onOpenArtifact: vi.fn(),
  onOpenFile: vi.fn(),
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

test("generic tool details stay collapsed while running and after completion", () => {
  const view = render(message(running));
  expect(screen.getByRole("button", { name: /fetch\s*Running/ }).getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText(/raw-input/)).toBeNull();

  view.rerender(message({ ...running, state: "output-available", output: { result: "raw-output" } }));
  const trigger = screen.getByRole("button", { name: /fetch\s*Completed/ });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText(/raw-output/)).toBeNull();
  fireEvent.click(trigger);
  expect(screen.getByText(/raw-input/)).toBeTruthy();
  expect(screen.getByText(/raw-output/)).toBeTruthy();
});

test("stream updates preserve a user's expanded tool details", () => {
  const view = render(message(running));
  fireEvent.click(screen.getByRole("button", { name: /fetch\s*Running/ }));
  view.rerender(message({ ...running, state: "output-available", output: "raw-output" }));
  expect(screen.getByRole("button", { name: /fetch\s*Completed/ }).getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText("raw-output")).toBeTruthy();
});

test("required approval stays visible and actionable", () => {
  render(message({ ...running, state: "approval-requested", approval: { id: "approval" } }));
  fireEvent.click(screen.getByRole("button", { name: "允许" }));
  expect(props.onToolApproval).toHaveBeenCalledWith("approval", true);
});

test("tool failure surfaces its reason without an extra click", () => {
  render(message({ ...running, state: "output-error", errorText: "连接超时" }));
  expect(screen.getByText("连接超时")).toBeTruthy();
  expect(screen.getByRole("button", { name: /fetch\s*Error/ }).getAttribute("aria-expanded")).toBe("true");
});
