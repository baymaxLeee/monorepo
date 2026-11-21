import { fireEvent, isInaccessible, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AskUserInput } from "../lib/ask-user";
import { AskUserToolCard } from "./AskUserToolCard";

const batchedInput: AskUserInput = {
  questions: [
    {
      id: "framework",
      header: "技术栈",
      question: "选择技术栈",
      options: [
        { label: "React", description: "组件生态" },
        { label: "Vue", description: "渐进式框架" },
      ],
    },
    {
      id: "priority",
      header: "优先级",
      question: "选择优先级",
      options: [
        { label: "高", description: "优先处理" },
        { label: "低", description: "稍后处理" },
      ],
    },
  ],
};

describe("AskUserToolCard", () => {
  it("collects a single fixed choice using the ask_user output contract", () => {
    const onSubmit = vi.fn();
    const input: AskUserInput = { questions: [{ ...batchedInput.questions[1] }] };

    render(<AskUserToolCard input={input} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("radio", { name: /^高/ }));
    fireEvent.click(screen.getByRole("button", { name: "提交" }));

    expect(onSubmit).toHaveBeenCalledWith({ answers: { priority: { answers: ["高"] } } });
  });

  it("walks a required batch and returns the selected answers keyed by question ID", () => {
    const onSubmit = vi.fn();

    render(<AskUserToolCard input={batchedInput} onSubmit={onSubmit} />);

    expect(isInaccessible(screen.getByText("选择技术栈"))).toBe(false);
    expect(isInaccessible(screen.getByText("选择优先级"))).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /^React/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "其他" }), {
      target: { value: "Svelte" },
    });
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    expect(isInaccessible(screen.getByText("选择技术栈"))).toBe(true);
    expect(isInaccessible(screen.getByText("选择优先级"))).toBe(false);
    fireEvent.click(screen.getByRole("radio", { name: /^低/ }));
    fireEvent.click(screen.getByRole("button", { name: "提交" }));

    expect(onSubmit).toHaveBeenCalledWith({
      answers: { framework: { answers: ["Svelte"] }, priority: { answers: ["低"] } },
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
      questions: [batchedInput.questions[1]],
    };

    render(<AskUserToolCard input={input} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("radio", { name: /^高/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "其他" }), { target: { value: "  中  " } });
    fireEvent.click(screen.getByRole("button", { name: "提交" }));

    expect(onSubmit).toHaveBeenCalledWith({ answers: { priority: { answers: ["中"] } } });
  });

  it("renders every selected option with its explanation and the free-form alternative", () => {
    render(<AskUserToolCard input={{ questions: [batchedInput.questions[0]] }} onSubmit={vi.fn()} />);
    expect(screen.getByText("组件生态")).toBeTruthy();
    expect(screen.getByText("渐进式框架")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "其他" })).toBeTruthy();
  });
});
