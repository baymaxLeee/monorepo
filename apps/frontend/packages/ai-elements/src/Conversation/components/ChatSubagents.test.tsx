import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatSubagents } from "./ChatSubagents";

describe("ChatSubagents", () => {
  it("renders multiple independently streaming subagents", () => {
    render(
      <ChatSubagents
        output={{
          ok: true,
          status: "running",
          progress: {
            model: "research-model",
            subagents: [
              {
                id: "market",
                task: "Research market adoption.",
                status: "running",
                message: {
                  id: "market-message",
                  role: "assistant",
                  parts: [
                    {
                      type: "tool-web_search",
                      toolCallId: "market-search",
                      state: "input-available",
                      input: { query: "market adoption" },
                    },
                  ],
                },
              },
              { id: "technology", task: "Research the architecture.", status: "running" },
            ],
          },
        }}
      />,
    );

    expect(screen.getByText("Subagent · market · 运行中")).toBeTruthy();
    expect(screen.getByText("Subagent · technology · 运行中")).toBeTruthy();
    expect(screen.getAllByText("research-model")).toHaveLength(2);
    expect(screen.getByText("检索公开来源")).toBeTruthy();
    const triggers = screen.getAllByRole("button", { name: /Subagent ·/ });
    expect(triggers[0]?.getAttribute("aria-expanded")).toBe("true");
    expect(triggers[1]?.getAttribute("aria-expanded")).toBe("true");
  });

  it("renders each final report and step count", () => {
    render(
      <ChatSubagents
        output={{
          ok: true,
          status: "completed",
          data: {
            model: "research-model",
            subagents: [
              {
                id: "market",
                task: "Research market adoption.",
                status: "completed",
                steps: 3,
                report: "Market evidence with [source](https://example.com/market).",
              },
              {
                id: "technology",
                task: "Research the architecture.",
                status: "completed",
                steps: 2,
                report: "Technology evidence with [source](https://example.com/technology).",
              },
            ],
          },
        }}
      />,
    );

    expect(screen.getByText("Subagent · market · 已完成 · 3 步")).toBeTruthy();
    expect(screen.getByText("Subagent · technology · 已完成 · 2 步")).toBeTruthy();
    expect(document.body.textContent).toContain("Market evidence");
    expect(document.body.textContent).toContain("Technology evidence");
    for (const trigger of screen.getAllByRole("button", { name: /Subagent ·/ })) {
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
    }
  });

  it("keeps batch failures visible", () => {
    render(<ChatSubagents output={undefined} errorText="provider unavailable" />);

    const trigger = screen.getByRole("button", { name: /Subagents · 失败/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole("alert").textContent).toContain("provider unavailable");
  });
});
