import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { ContextUsage } from "./context";

test("shows active usage, automatic compaction headroom, and compacted history", async () => {
  render(
    <ContextUsage
      value={{
        usedTokens: 50_000,
        contextWindow: 128_000,
        autoCompactAt: 89_600,
        estimated: false,
        compacted: true,
        categories: [
          { id: "system", tokens: 10_000 },
          { id: "conversation", tokens: 40_000 },
        ],
      }}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "上下文已使用 39%" }));
  expect(await screen.findByText("50K / 128K tokens")).toBeTruthy();
  expect(screen.getByText("距自动压缩约 39.6K tokens")).toBeTruthy();
  expect(screen.getByText("较早历史已压缩为摘要；原始消息仍完整保留。")).toBeTruthy();
  expect(screen.getByText("分类占比为估算，总量优先采用模型返回的用量。")).toBeTruthy();
});

test("labels pre-provider usage as estimated", async () => {
  render(
    <ContextUsage
      value={{
        usedTokens: 25_000,
        contextWindow: 100_000,
        autoCompactAt: 70_000,
        estimated: true,
        categories: [{ id: "conversation", tokens: 25_000 }],
      }}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "上下文预计使用 25%" }));
  expect(await screen.findByText("≈25K / 100K tokens")).toBeTruthy();
  expect(screen.getByText("预计使用 25%")).toBeTruthy();
});

test("reports calculation progress before the first usage snapshot", async () => {
  render(<ContextUsage value={null} loading />);

  fireEvent.click(screen.getByRole("button", { name: "查看上下文用量" }));
  expect(await screen.findByText("正在计算上下文…")).toBeTruthy();
});
