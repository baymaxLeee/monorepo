import { fireEvent, isInaccessible, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { Terminal } from "./terminal";

vi.mock("@repo/design-system/use-highlighted-code", () => ({
  useHighlightedCode: (text: string) => text.split("\n"),
}));

test("bash streams a compact status by default, with command and logs available on demand", () => {
  const command = "bash report.sh\necho finished";
  const view = (output: string, isStreaming: boolean) => (
    <Terminal command={command} output={output} isStreaming={isStreaming} exitCode={isStreaming ? undefined : 0} />
  );
  const { rerender } = render(view("日志 1", true));
  const trigger = screen.getByRole("button", { name: /bash report.sh.*运行中/ });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("日志 1")).toBeNull();
  rerender(view("日志 1\n日志 2", true));
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(trigger);
  expect(isInaccessible(screen.getByText("日志 2"))).toBe(false);
  expect(screen.getByText(/echo finished/).textContent).toBe(command);
  rerender(view("日志 1\n日志 2\n日志 3", false));
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(isInaccessible(screen.getByText("日志 3"))).toBe(false);
});

test("a failed bash call exposes its failure status while details remain collapsible", () => {
  render(<Terminal command="bash report.sh" output="permission denied" exitCode={1} />);
  const trigger = screen.getByRole("button", { name: /失败（退出码 1）/ });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(trigger);
  expect(isInaccessible(screen.getByText("permission denied"))).toBe(false);
});
