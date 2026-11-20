import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { ChatConversationActions } from "./ChatConversationActions";

test("the shared conversation menu exposes trace, export and delete", async () => {
  render(
    <ChatConversationActions
      conversation={{
        id: "conversation",
        title: "Project review",
      }}
      onDelete={vi.fn()}
      onExport={vi.fn()}
      onOpenTrace={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Project review 更多操作" }));

  expect(await screen.findByRole("menuitem", { name: "执行轨迹" })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: "导出 Markdown" })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: "删除会话" })).toBeTruthy();
});
