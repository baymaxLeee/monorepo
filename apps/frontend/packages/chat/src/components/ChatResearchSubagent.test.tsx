import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatResearchSubagent } from "./ChatResearchSubagent";

describe("ChatResearchSubagent", () => {
  it("renders nested research progress from preliminary tool output", () => {
    render(
      <ChatResearchSubagent
        output={{
          ok: true,
          status: "running",
          progress: {
            model: "research-model",
            message: {
              id: "nested-message",
              role: "assistant",
              parts: [
                {
                  type: "tool-web_search",
                  toolCallId: "nested-search",
                  state: "input-available",
                  input: { query: "AI SDK subagents" },
                },
              ],
            },
          },
        }}
      />,
    );

    expect(screen.getByText("深度研究 · 运行中")).toBeTruthy();
    expect(screen.getByText("research-model")).toBeTruthy();
    expect(screen.getByText("检索公开来源")).toBeTruthy();
  });

  it("renders the compressed final report and step count", () => {
    render(
      <ChatResearchSubagent
        output={{
          ok: true,
          status: "completed",
          data: {
            model: "research-model",
            steps: 3,
            report: "Evidence-backed report with [source](https://example.com).",
            message: {
              id: "nested-message",
              role: "assistant",
              parts: [{ type: "text", text: "Evidence-backed report with source." }],
            },
          },
        }}
      />,
    );

    expect(screen.getByText("深度研究 · 已完成 · 3 步")).toBeTruthy();
    expect(document.body.textContent).toContain("Evidence-backed report with");
  });

  it("keeps failures visible", () => {
    render(<ChatResearchSubagent output={undefined} errorText="provider unavailable" />);

    expect(screen.getByRole("alert").textContent).toContain("provider unavailable");
  });
});
