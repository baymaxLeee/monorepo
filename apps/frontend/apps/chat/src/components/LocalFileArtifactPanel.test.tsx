import type { DesktopBridge } from "@repo/runtime/desktop";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, Link, RouterProvider } from "react-router-dom";
import { expect, it, vi } from "vitest";

import { LocalFileArtifactPanel } from "./LocalFileArtifactPanel";

vi.mock("@repo/editors/code-editor", () => ({
  CodeEditor: ({
    value,
    onChange,
    readOnly,
  }: {
    value: string;
    onChange?: (value: string) => void;
    readOnly?: boolean;
  }) => (
    <textarea
      aria-label={readOnly ? "文件预览" : "文件内容"}
      value={value}
      readOnly={readOnly}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}));

vi.mock("@repo/editors/markdown-editor", () => ({
  MarkdownEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="Markdown 内容" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

it("opens Markdown directly in the editor and saves to the selected workspace file", async () => {
  const writeFile = vi.fn().mockResolvedValue({ hash: "updated" });
  const bridge = {
    readFile: vi.fn(async () => ({ content: "# Original", hash: "original" })),
    writeFile,
    subscribe: () => () => {},
  } as unknown as DesktopBridge;
  render(<LocalFileArtifactPanel bridge={bridge} threadId="thread" path="reports/report.md" onClose={vi.fn()} />);
  const editor = await screen.findByRole("textbox", { name: "Markdown 内容" });
  expect((editor as HTMLTextAreaElement).value).toBe("# Original");
  fireEvent.change(editor, { target: { value: "# Updated" } });
  fireEvent.click(screen.getByRole("button", { name: "保存文件" }));
  await screen.findByText("已保存");
  expect(writeFile).toHaveBeenCalledWith("thread", "reports/report.md", "# Updated", "original");
});

it("uses the shared artifact UI while reading and saving through the local bridge", async () => {
  const writeFile = vi.fn().mockRejectedValue(new Error("文件已改变"));
  const bridge = {
    readFile: vi.fn(async () => ({ content: "original", hash: "original-hash" })),
    writeFile,
    subscribe: () => () => {},
  } as unknown as DesktopBridge;
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <>
          <Link to="/next">切换会话</Link>
          <LocalFileArtifactPanel bridge={bridge} threadId="thread" path="src/demo.js" onClose={vi.fn()} />
        </>
      ),
    },
    { path: "/next", element: <p>其他会话</p> },
  ]);
  render(<RouterProvider router={router} />);

  const editor = await screen.findByRole("textbox", { name: "文件内容" });
  fireEvent.change(editor, { target: { value: "my draft" } });
  fireEvent.click(screen.getByRole("button", { name: "保存文件" }));
  await screen.findByRole("alert");

  expect(writeFile).toHaveBeenCalledWith("thread", "src/demo.js", "my draft", "original-hash");
  expect((editor as HTMLTextAreaElement).value).toBe("my draft");
  fireEvent.click(screen.getByRole("link", { name: "切换会话" }));
  await screen.findByRole("alertdialog");
  fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(router.state.location.pathname).toBe("/");
});

it("renders local HTML through the same sandboxed artifact preview", async () => {
  const bridge = {
    readFile: vi.fn(async () => ({ content: "<!doctype html><h1>Local report</h1>", hash: "hash" })),
    subscribe: () => () => {},
  } as unknown as DesktopBridge;

  render(<LocalFileArtifactPanel bridge={bridge} threadId="thread" path="report.html" onClose={vi.fn()} />);

  const frame = await screen.findByTitle("report.html");
  expect(frame.getAttribute("srcdoc")).toContain("Local report");
  expect(frame.getAttribute("sandbox")).toContain("allow-scripts");
});

it("keeps a local draft when the file changes on disk", async () => {
  let notify: Parameters<DesktopBridge["subscribe"]>[0] = () => {};
  const bridge = {
    readFile: vi.fn(async () => ({ content: "original", hash: "hash" })),
    writeFile: vi.fn(),
    subscribe: vi.fn((listener) => {
      notify = listener;
      return () => {};
    }),
  } as unknown as DesktopBridge;

  render(<LocalFileArtifactPanel bridge={bridge} threadId="thread" path="demo.js" onClose={vi.fn()} />);
  await screen.findByRole("textbox", { name: "文件内容" });
  fireEvent.change(screen.getByRole("textbox", { name: "文件内容" }), { target: { value: "draft" } });
  notify({ type: "files", threadId: "thread", paths: ["demo.js"] });

  expect((await screen.findByRole("alert")).textContent).toContain("草稿已保留");
  expect((screen.getByRole("textbox", { name: "文件内容" }) as HTMLTextAreaElement).value).toBe("draft");
});
