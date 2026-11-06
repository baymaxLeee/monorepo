import { useChat } from "@ai-sdk/react";
import { createChat } from "@shadcn/helpers/ai-sdk";
import { act, renderHook, waitFor } from "@testing-library/react";
import { lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import { expect, test } from "vitest";

test("official fixture transport drives real SDK approval denial and continuation", async () => {
  const script = createChat()
    .user("检查文件")
    .assistant(({ writer }) => {
      writer.text("需要执行命令", { mode: "instant" });
      writer.tool("bash", { input: { command: "check" }, needsApproval: true, output: { stdout: "完成" } });
    })
    .assistant(({ writer, toolCall }) => {
      writer.text(toolCall?.denied ? "已取消执行" : "执行完成", { mode: "instant" });
    });
  const view = renderHook(() =>
    useChat({
      transport: script.transport({ delayMs: 0 }),
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    }),
  );
  await act(() => view.result.current.sendMessage({ text: "检查文件" }));
  await waitFor(() => expect(view.result.current.status).toBe("ready"));
  const part = view.result.current.messages
    .at(-1)
    ?.parts.find((part) => "state" in part && part.state === "approval-requested");
  if (!part || !("approval" in part) || !part.approval) throw new Error("approval part missing");
  await act(async () => {
    await view.result.current.addToolApprovalResponse({ id: part.approval!.id, approved: false });
  });
  await waitFor(() =>
    expect(
      view.result.current.messages.at(-1)?.parts.some((part) => part.type === "text" && part.text === "已取消执行"),
    ).toBe(true),
  );
  const all = view.result.current.messages.flatMap((message) => message.parts);
  expect(all.some((part) => "state" in part && part.state === "output-denied")).toBe(true);
  expect(all.some((part) => "output" in part && part.output)).toBe(false);
});

test("hydrated historical tool results do not replay on mount", async () => {
  const script = createChat()
    .user("历史问题")
    .assistant(({ writer }) => {
      writer.tool("bash", { input: { command: "check" }, output: { stdout: "历史结果" } });
      writer.text("已经完成", { mode: "instant" });
    });
  const messages = script.get();
  const view = renderHook(() => useChat({ messages, transport: script.transport({ delayMs: 0 }) }));
  await act(async () => {});
  expect(view.result.current.status).toBe("ready");
  expect(view.result.current.messages).toEqual(messages);
});
