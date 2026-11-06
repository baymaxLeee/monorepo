import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { SuggestionList } from "./SuggestionList";

test("suggestions can be activated through the native click path", () => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  const onPick = vi.fn();
  render(<SuggestionList options={[{ key: "one", content: "文件" }]} onPick={onPick} />);
  fireEvent.click(screen.getByRole("option", { name: "文件" }));
  expect(onPick).toHaveBeenCalledWith(0);
});
