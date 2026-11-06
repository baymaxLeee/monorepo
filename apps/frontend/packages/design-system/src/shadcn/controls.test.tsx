import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { Meter } from "./meter";
import { NumberInput } from "./number-field";
import { Toolbar, ToolbarButton } from "./toolbar";

test("meter exposes capacity rather than completion semantics", () => {
  render(<Meter value={35} aria-label="上下文用量" />);
  expect(screen.getByRole("meter", { name: "上下文用量" }).getAttribute("aria-valuenow")).toBe("35");
});
test("number field enforces bounds and supports keyboard stepping", () => {
  const change = vi.fn();
  render(
    <>
      <label htmlFor="amount">数量</label>
      <NumberInput id="amount" defaultValue={2} min={1} max={3} onValueChange={change} />
    </>,
  );
  const input = screen.getByRole("textbox", { name: "数量" });
  fireEvent.keyDown(input, { key: "ArrowUp" });
  expect(change.mock.calls.at(-1)?.[0]).toBe(3);
  expect(screen.getByRole("button", { name: "增加" }).hasAttribute("disabled")).toBe(true);
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(change.mock.calls.at(-1)?.[0]).toBe(2);
});
test("toolbar moves focus across its actions", async () => {
  render(
    <Toolbar aria-label="预览操作">
      <ToolbarButton>下载</ToolbarButton>
      <ToolbarButton>关闭</ToolbarButton>
    </Toolbar>,
  );
  const download = screen.getByRole("button", { name: "下载" });
  act(() => download.focus());
  fireEvent.keyDown(download, { key: "ArrowRight" });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "关闭" })));
});
