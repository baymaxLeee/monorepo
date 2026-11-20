import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { DesktopNewConversationPrompt } from "./DesktopNewConversationPrompt";

vi.stubGlobal(
  "ResizeObserver",
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
Element.prototype.scrollIntoView = vi.fn();

test("Desktop new conversation mirrors the Codex context-bar editor composition", async () => {
  const onLocationChange = vi.fn();
  const onProjectChange = vi.fn();
  render(
    <DesktopNewConversationPrompt
      location="local"
      onLocationChange={onLocationChange}
      projects={["/projects/monorepo"]}
      project="/projects/monorepo"
      onProjectChange={onProjectChange}
      onCreateProject={vi.fn()}
      placeholder="随心输入"
      maxFiles={8}
      onSubmit={vi.fn()}
    />,
  );

  const contextBar = screen.getByTestId("desktop-new-conversation-context");
  const editor = screen.getByTestId("desktop-new-conversation-editor");
  expect(contextBar.className).toContain("mx-4");
  expect(contextBar.className).toContain("h-14");
  expect(contextBar.className).toContain("rounded-t-[1.25rem]");
  expect(contextBar.firstElementChild?.classList.contains("h-10")).toBe(true);
  expect(contextBar.contains(editor)).toBe(false);
  expect(contextBar.parentElement).toBe(editor.parentElement);
  const prompt = editor.querySelector(".prompt-input");
  expect(prompt?.className).toContain("[&_[data-slot=input-group]]:min-h-24!");
  expect(prompt?.className).toContain("[&_[data-slot=input-group]]:rounded-2xl!");
  expect(prompt?.className).toContain("[&_.prompt-input-prosemirror]:min-h-10");
  expect(prompt?.className).toContain("[&_.prompt-input-footer]:mt-auto");
  expect(prompt?.className).toContain("[&_.prompt-input-footer]:pb-1");
  const locationTrigger = screen.getByRole("combobox", { name: "执行位置" });
  expect(locationTrigger.textContent).toContain("此计算机");
  expect(locationTrigger.classList.contains("hover:bg-foreground/10")).toBe(true);
  expect(locationTrigger.classList.contains("aria-expanded:bg-foreground/10")).toBe(true);
  expect(locationTrigger.classList.contains("data-[size=sm]:rounded-full")).toBe(true);
  expect(locationTrigger.classList.contains("text-xs")).toBe(true);
  const projectTrigger = screen.getByRole("combobox", { name: "选择项目" });
  expect(projectTrigger.textContent).toContain("monorepo");
  expect(projectTrigger.classList.contains("rounded-full")).toBe(true);
  expect(projectTrigger.classList.contains("hover:bg-foreground/10")).toBe(true);
  expect(projectTrigger.classList.contains("aria-expanded:bg-foreground/10")).toBe(true);
  expect(projectTrigger.classList.contains("text-xs")).toBe(true);
  expect(screen.queryByRole("button", { name: "更多会话选项" })).toBeNull();

  fireEvent.click(locationTrigger);
  const cloudOption = await screen.findByRole("option", { name: "云端" });
  expect(cloudOption.closest('[data-side="top"]')).toBeTruthy();
  fireEvent.pointerDown(cloudOption, { pointerType: "mouse" });
  fireEvent.click(cloudOption, { pointerType: "mouse" });
  expect(onLocationChange).toHaveBeenCalledWith("cloud");

  fireEvent.click(projectTrigger);
  const projectSearch = await screen.findByPlaceholderText("搜索项目");
  expect(projectSearch.closest('[data-side="top"]')).toBeTruthy();
  const projectContent = projectSearch.closest('[data-slot="combobox-content"]');
  expect(projectContent?.classList.contains("w-64")).toBe(true);
  expect(projectContent?.classList.contains("*:data-[slot=input-group]:bg-transparent!")).toBe(true);
  expect(screen.queryByText("/projects/monorepo")).toBeNull();
  expect(screen.queryByText("项目")).toBeNull();
  expect(screen.getAllByText("monorepo")).toHaveLength(2);
});

test("keeps the editor writable but freezes its creation context while submitting", () => {
  render(
    <DesktopNewConversationPrompt
      contextDisabled
      location="local"
      onLocationChange={vi.fn()}
      projects={["/projects/monorepo"]}
      project="/projects/monorepo"
      onProjectChange={vi.fn()}
      onCreateProject={vi.fn()}
      placeholder="随心输入"
      maxFiles={8}
      onSubmit={vi.fn()}
    />,
  );

  expect((screen.getByRole("combobox", { name: "执行位置" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("combobox", { name: "选择项目" }) as HTMLButtonElement).disabled).toBe(true);
  expect(
    screen.getByTestId("desktop-new-conversation-editor").querySelector(".prompt-input")?.getAttribute("aria-disabled"),
  ).toBeNull();
});

test("marks local execution unavailable when the native host cannot provide it", async () => {
  render(
    <DesktopNewConversationPrompt
      localAvailable={false}
      location="cloud"
      onLocationChange={vi.fn()}
      projects={[]}
      project={null}
      onProjectChange={vi.fn()}
      onCreateProject={vi.fn()}
      placeholder="随心输入"
      maxFiles={8}
      onSubmit={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("combobox", { name: "执行位置" }));
  const localOption = await screen.findByRole("option", { name: "此计算机（不可用）" });
  expect(localOption.getAttribute("aria-disabled")).toBe("true");
});
