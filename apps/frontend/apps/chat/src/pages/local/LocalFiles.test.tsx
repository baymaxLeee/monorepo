import type { DesktopBridge } from "@repo/runtime/desktop";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, Link, RouterProvider } from "react-router-dom";
import { expect, it, vi } from "vitest";

import { LocalFiles } from "./LocalFiles";

vi.mock("@repo/editors/code-editor", () => ({
  CodeEditor: ({ value, onChange }: { value: string; onChange(value: string): void }) => (
    <textarea aria-label="文件内容" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));
it("preserves an edited draft after a stale-save rejection and blocks accidental route departure", async () => {
  const writeFile = vi.fn().mockRejectedValue(new Error("文件已改变"));
  const bridge = {
    listFiles: async () => [{ name: "demo.js", directory: false, symlink: false }],
    readFile: async () => ({ content: "original", hash: "original-hash" }),
    writeFile,
    subscribe: () => () => {},
  } as unknown as DesktopBridge;
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <>
          <Link to="/next">切换会话</Link>
          <LocalFiles bridge={bridge} id="thread" />
        </>
      ),
    },
    { path: "/next", element: <p>其他会话</p> },
  ]);
  render(<RouterProvider router={router} />);
  fireEvent.click(await screen.findByRole("button", { name: "demo.js" }));
  const editor = await screen.findByRole("textbox", { name: "文件内容" });
  fireEvent.change(editor, { target: { value: "my draft" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByRole("alert");
  expect(writeFile).toHaveBeenCalledWith("thread", "demo.js", "my draft", "original-hash");
  expect((editor as HTMLTextAreaElement).value).toBe("my draft");
  fireEvent.click(screen.getByRole("link", { name: "切换会话" }));
  await screen.findByRole("alertdialog");
  fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBe(null));
  expect((screen.getByRole("textbox", { name: "文件内容" }) as HTMLTextAreaElement).value).toBe("my draft");
  expect(router.state.location.pathname).toBe("/");
});
