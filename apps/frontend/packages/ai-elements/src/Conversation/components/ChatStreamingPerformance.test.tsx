import type * as AiElements from "@repo/ai-elements";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, expect, test, vi } from "vitest";

import type { ChatUIMessage } from "../lib/chat-message";
import type * as TapParser from "../lib/tap-results";
import { ChatMessageView, type ChatMessageViewProps } from "./ChatMessageView";
import { ChatTerminalTool } from "./ChatTerminalTool";

const work = vi.hoisted(() => ({ parseBlock: vi.fn(), parseTap: vi.fn(), terminal: vi.fn() }));
vi.mock("@repo/ai-elements", async (original) => {
  const actual = await original<typeof AiElements>();
  const remarkPlugins = [
    () => () => {
      work.parseBlock();
    },
  ];
  return {
    ...actual,
    MessageResponse: (props: ComponentProps<typeof actual.MessageResponse>) => (
      <actual.MessageResponse {...props} remarkPlugins={remarkPlugins} />
    ),
  };
});
vi.mock("../lib/tap-results", async (original) => {
  const actual = await original<typeof TapParser>();
  return {
    parseTapResults: (stdout: string) => {
      work.parseTap();
      return actual.parseTapResults(stdout);
    },
  };
});
vi.mock("@repo/ai-elements/terminal", () => ({
  Terminal: (props: { output: string }) => {
    work.terminal();
    return <pre>{props.output}</pre>;
  },
}));

const props: Omit<ChatMessageViewProps, "message"> = {
  conversationId: "conversation",
  streaming: true,
  deliverableCompletion: { artifact: [], image: [], video: [] },
  onOpenArtifact: vi.fn(),
  onOpenFile: vi.fn(),
  onAnswerClientTool: vi.fn(),
  onToolApproval: vi.fn(),
  onExecutePlan: vi.fn(),
  planExecutedIds: new Set(),
  planBusy: false,
};
const paragraphs = Array.from({ length: 30 }, (_, index) => `已完成的第 ${index} 段。`).join("\n\n");
function message(text: string, parts: ChatUIMessage["parts"] = []): ChatUIMessage {
  return { id: "reply", role: "assistant", parts: [...parts, { type: "text", text, state: "streaming" }] };
}
beforeEach(() => vi.clearAllMocks());

test.each([false, true])("streaming only reparses the unfinished block (sources: %s)", (cited) => {
  const sources: ChatUIMessage["parts"] = cited
    ? [{ type: "source-url", sourceId: "doc", url: "https://example.com/doc", title: "文档" }]
    : [];
  const head = cited ? paragraphs.replace("第 0 段", "[文档](https://example.com/doc)") : paragraphs;
  const view = render(<ChatMessageView {...props} message={message(`${head}\n\n输出`, sources)} />);
  expect(work.parseBlock).toHaveBeenCalledTimes(31);
  work.parseBlock.mockClear();
  for (let i = 0; i < 10; i++) {
    view.rerender(<ChatMessageView {...props} message={message(`${head}\n\n输出 ${i}`, structuredClone(sources))} />);
  }
  expect(work.parseBlock).toHaveBeenCalledTimes(10);
});

test("late sources update an existing link without reparsing completed Markdown", () => {
  const text = "根据[文档](https://example.com/doc)。";
  const view = render(<ChatMessageView {...props} message={message(text)} />);
  work.parseBlock.mockClear();
  const withSource = message(text);
  withSource.parts.push({ type: "source-url", sourceId: "doc", url: "https://example.com/doc", title: "新来源" });
  view.rerender(<ChatMessageView {...props} message={withSource} />);
  expect(screen.getByRole("link", { name: /文档/ }).textContent).toContain("新标签页");
  expect(work.parseBlock).not.toHaveBeenCalled();
  view.rerender(<ChatMessageView {...props} message={message(text)} />);
  expect(screen.getByRole("link", { name: "文档" }).textContent).toBe("文档");
  expect(work.parseBlock).not.toHaveBeenCalled();
});

test("completed terminal work is isolated from subsequent text chunks", async () => {
  const tool: ChatUIMessage["parts"][number] = {
    type: "tool-bash",
    toolCallId: "bash",
    state: "output-available",
    input: { command: "test" },
    output: { stdout: "TAP version 13\nok 1 - valid\n1..1", exitCode: 0 },
    toolMetadata: { agent: { uiKind: "terminal" } },
  };
  const view = render(<ChatMessageView {...props} message={message("输出", [tool])} />);
  await screen.findByText(/TAP version 13/);
  const parsed = work.parseTap.mock.calls.length;
  const rendered = work.terminal.mock.calls.length;
  for (let i = 0; i < 10; i++)
    view.rerender(<ChatMessageView {...props} message={message(`输出 ${i}`, [structuredClone(tool)])} />);
  expect(work.parseTap).toHaveBeenCalledTimes(parsed);
  expect(work.terminal).toHaveBeenCalledTimes(rendered);
});

test("terminal parsing follows stdout and completion, while stderr and command still update", async () => {
  const stdout = "TAP version 13\nok 1 - valid\n1..1";
  const view = render(<ChatTerminalTool input={{ command: "test" }} output={{ stdout }} running />);
  await screen.findByText(/TAP version 13/);
  expect(work.parseTap).not.toHaveBeenCalled();
  view.rerender(<ChatTerminalTool input={{ command: "test" }} output={{ stdout }} running={false} />);
  const parsed = work.parseTap.mock.calls.length;
  for (let i = 0; i < 10; i++)
    view.rerender(
      <ChatTerminalTool input={{ command: "test" }} output={{ stdout, stderr: `error ${i}` }} running={false} />,
    );
  expect(work.parseTap).toHaveBeenCalledTimes(parsed);
  expect(screen.getByText(/error 9/)).toBeTruthy();
  view.rerender(
    <ChatTerminalTool
      input={{ command: "test" }}
      output={{ stdout: stdout.replace("ok 1", "not ok 1") }}
      running={false}
    />,
  );
  expect(work.parseTap).toHaveBeenCalledTimes(parsed + 1);
  fireEvent.click(screen.getByRole("button", { name: /1 项失败/ }));
});

test("native range citations do not reparse completed blocks on later text deltas", () => {
  const cited = (suffix: string): ChatUIMessage => ({
    id: "reply",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: `${paragraphs}\n\n${suffix}`,
        state: "streaming",
        citations: [
          {
            source: {
              type: "source",
              sourceType: "url",
              id: "source",
              url: "https://example.com/source",
              title: "证据",
            },
            startIndex: 0,
            endIndex: 7,
          },
        ],
      },
    ],
  });
  const view = render(<ChatMessageView {...props} message={cited("输出")} />);
  work.parseBlock.mockClear();
  for (let i = 0; i < 10; i++) view.rerender(<ChatMessageView {...props} message={cited(`输出 ${i}`)} />);
  expect(work.parseBlock).toHaveBeenCalledTimes(10);
  expect(screen.getAllByRole("link", { name: "引用：证据" })).toHaveLength(1);
});

test("late native citations update their existing block without remounting the Markdown tree", () => {
  const text = "第一段。\n\n证据结论。";
  const initial = message(text);
  const view = render(<ChatMessageView {...props} message={initial} />);
  const firstParagraph = screen.getByText("第一段。");
  work.parseBlock.mockClear();
  const late: ChatUIMessage = {
    ...initial,
    parts: [
      {
        type: "text",
        text,
        citations: [
          {
            source: {
              type: "source",
              sourceType: "url",
              id: "source",
              url: "https://example.com/source",
              title: "证据",
            },
            startIndex: 7,
            endIndex: 11,
          },
        ],
      },
    ],
  };
  view.rerender(<ChatMessageView {...props} message={late} />);
  expect(screen.getByText("第一段。")).toBe(firstParagraph);
  expect(screen.getByRole("link", { name: "引用：证据" })).toBeTruthy();
  expect(work.parseBlock).toHaveBeenCalledTimes(1);
});
