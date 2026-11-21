import { fireEvent, isInaccessible, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { ChatTerminalTool } from "../Conversation/components/ChatTerminalTool";
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

test("tool failure shows the reason and only reports an exit code supplied by the process", async () => {
  const props = { input: { cmd: "test" }, running: false };
  const view = render(<ChatTerminalTool {...props} output={undefined} errorText="审批恢复失败" />);
  const trigger = await screen.findByRole("button", { name: /test.*失败/ });
  expect(trigger.textContent).not.toContain("退出码");
  fireEvent.click(trigger);
  expect(screen.getByText("审批恢复失败")).toBeTruthy();
  view.rerender(
    <ChatTerminalTool
      {...props}
      output={{
        ok: false,
        status: "partial",
        error: { code: "bash_exit", message: "command failed", retryable: false },
        data: { exit_code: 17, output: "" },
      }}
    />,
  );
  expect(trigger.textContent).toContain("退出码 17");
});
