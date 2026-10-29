import { fireEvent, isInaccessible, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AskUserInput } from "../lib/ask-user";
import { AskUserToolCard } from "./AskUserToolCard";

const batchedInput: AskUserInput = {
  questions: [
    {
      id: "framework",
      question: "选择技术栈",
      choices: [
        { label: "React", value: "react" },
        { label: "Vue", value: "vue" },
      ],
      mode: "multiple",
      allowFreeform: true,
      freeformLabel: "其他技术栈",
    },
    {
      id: "priority",
      question: "选择优先级",
      choices: [
        { label: "高", value: "high" },
        { label: "低", value: "low" },
      ],
      mode: "single",
      allowFreeform: false,
      freeformLabel: "其他",
    },
  ],
};

describe("AskUserToolCard", () => {
  it("collects a single fixed choice using the ask_user output contract", () => {
    const onSubmit = vi.fn();
    const input: AskUserInput = { questions: [{ ...batchedInput.questions[1] }] };

    render(<AskUserToolCard input={input} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("radio", { name: "高" }));
    fireEvent.click(screen.getByRole("button", { name: "提交" }));

    expect(onSubmit).toHaveBeenCalledWith({ answers: [{ id: "priority", values: ["high"] }] });
  });

  it("walks a required batch and preserves all multiple-choice values", () => {
    const onSubmit = vi.fn();

    render(<AskUserToolCard input={batchedInput} onSubmit={onSubmit} />);

    expect(isInaccessible(screen.getByText("选择技术栈"))).toBe(false);
    expect(isInaccessible(screen.getByText("选择优先级"))).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "React" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Vue" }));
    fireEvent.change(screen.getByRole("textbox", { name: "其他技术栈" }), {
      target: { value: "Svelte" },
    });
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    expect(isInaccessible(screen.getByText("选择技术栈"))).toBe(true);
    expect(isInaccessible(screen.getByText("选择优先级"))).toBe(false);
    fireEvent.click(screen.getByRole("radio", { name: "低" }));
    fireEvent.click(screen.getByRole("button", { name: "提交" }));

    expect(onSubmit).toHaveBeenCalledWith({
      answers: [
        { id: "framework", values: ["react", "vue", "Svelte"] },
        { id: "priority", values: ["low"] },
      ],
    });
  });

  it("keeps the user on an unanswered required question", () => {
    render(<AskUserToolCard input={batchedInput} onSubmit={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    expect(isInaccessible(screen.getByText("选择技术栈"))).toBe(false);
    expect(screen.getByRole("alert").textContent).toContain("请选择或输入一个答案后继续。");
  });

  it("treats freeform text as the single selected answer", () => {
    const onSubmit = vi.fn();
    const input: AskUserInput = {
      questions: [{ ...batchedInput.questions[1], allowFreeform: true }],
    };

    render(<AskUserToolCard input={input} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("radio", { name: "高" }));
    fireEvent.change(screen.getByRole("textbox", { name: "其他" }), { target: { value: "  中  " } });
    fireEvent.click(screen.getByRole("button", { name: "提交" }));

    expect(onSubmit).toHaveBeenCalledWith({ answers: [{ id: "priority", values: ["中"] }] });
  });

  it("supports a required freeform-only question", () => {
    const onSubmit = vi.fn();
    const input: AskUserInput = {
      questions: [
        {
          id: "context",
          question: "补充背景",
          choices: [],
          mode: "single",
          allowFreeform: true,
          freeformLabel: "请输入背景",
        },
      ],
    };

    render(<AskUserToolCard input={input} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByRole("textbox", { name: "请输入背景" }), {
      target: { value: "  需要离线运行  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交" }));

    expect(onSubmit).toHaveBeenCalledWith({ answers: [{ id: "context", values: ["需要离线运行"] }] });
  });
});
