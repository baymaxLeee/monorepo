import { fireEvent, render, screen } from "@testing-library/react";

import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRequest,
  ConfirmationTitle,
} from "./confirmation";
import { FileTree, FileTreeFile, FileTreeFolder } from "./file-tree";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "./reasoning";
import { TestResults } from "./test-results";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "./tool";

jest.mock("./message", () => ({ MessageResponse: ({ children }: { children: string }) => <div>{children}</div> }));

test("tool input may be absent while streaming, and errors remain inspectable", () => {
  const { rerender } = render(
    <Tool defaultOpen>
      <ToolHeader type="tool-fetch" state="input-streaming" />
      <ToolContent>
        <ToolInput input={undefined} />
      </ToolContent>
    </Tool>,
  );
  expect(screen.getByRole("button", { name: /fetch/ })).toHaveAttribute("aria-expanded", "true");
  rerender(
    <Tool defaultOpen>
      <ToolHeader type="tool-fetch" state="output-error" />
      <ToolContent>
        <ToolOutput output={undefined} errorText="请求失败" />
      </ToolContent>
    </Tool>,
  );
  expect(screen.getByText("请求失败")).toBeVisible();
});

test("a user's tool disclosure choice survives tool state updates", () => {
  const view = (running: boolean) => (
    <Tool defaultOpen={running}>
      <ToolHeader type="tool-fetch" state={running ? "input-streaming" : "output-available"} />
      <ToolContent>结果</ToolContent>
    </Tool>
  );
  const { rerender } = render(view(true));
  const trigger = screen.getByRole("button", { name: /fetch/ });
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(trigger);
  rerender(view(false));
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  rerender(view(true));
  expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("a user's reasoning disclosure choice survives streaming updates", () => {
  const view = (streaming: boolean) => (
    <Reasoning isStreaming={streaming}>
      <ReasoningTrigger />
      <ReasoningContent>过程摘要</ReasoningContent>
    </Reasoning>
  );
  const { rerender } = render(view(true));
  expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(screen.getByRole("button"));
  rerender(view(true));
  expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
  rerender(view(false));
  fireEvent.click(screen.getByRole("button"));
  rerender(view(true));
  expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
});

test("approval actions appear only while waiting and keep the user's decision", () => {
  const approve = jest.fn();
  const view = (state: "approval-requested" | "approval-responded") => (
    <Confirmation
      state={state}
      approval={{ id: "approval", ...(state === "approval-responded" ? { approved: true } : {}) }}
    >
      <ConfirmationRequest>
        <ConfirmationTitle>允许写入？</ConfirmationTitle>
      </ConfirmationRequest>
      <ConfirmationActions>
        <ConfirmationAction onClick={approve}>允许</ConfirmationAction>
      </ConfirmationActions>
    </Confirmation>
  );
  const { rerender } = render(view("approval-requested"));
  fireEvent.click(screen.getByRole("button", { name: "允许" }));
  expect(approve).toHaveBeenCalledTimes(1);
  rerender(view("approval-responded"));
  expect(screen.queryByRole("button", { name: "允许" })).not.toBeInTheDocument();
});

test("file actions are independent of file selection", () => {
  const select = jest.fn();
  const download = jest.fn();
  render(
    <FileTree onSelect={select}>
      <FileTreeFolder name="src" defaultOpen>
        <FileTreeFile path="src/main.ts" actions={<button onClick={download}>下载</button>} />
      </FileTreeFolder>
    </FileTree>,
  );
  fireEvent.click(screen.getByRole("button", { name: "下载" }));
  expect(download).toHaveBeenCalledTimes(1);
  expect(select).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "main.ts" }));
  expect(select).toHaveBeenCalledWith("src/main.ts");
  expect(screen.getByRole("button", { name: "main.ts" })).toHaveAttribute("aria-pressed", "true");
});

test("failed suites expand to the failure details", () => {
  render(
    <TestResults
      suites={[
        { id: "s", name: "套件", tests: [{ id: "t", name: "失败测试", status: "failed", error: "期望值不匹配" }] },
      ]}
    />,
  );
  expect(screen.getByText("期望值不匹配")).toBeVisible();
  expect(screen.getByRole("button", { name: /1 项失败/ })).toHaveAttribute("aria-expanded", "true");
});
