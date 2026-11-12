import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  createStorageDownloadUrl: vi.fn(),
  downloadAssetUrl: vi.fn(),
  fetchAssetText: vi.fn(),
  fetchConversationFile: vi.fn(),
  updateConversationFileContent: vi.fn(),
}));
const store = vi.hoisted(() => ({
  artifactPreview: {
    open: true,
    conversationId: "conversation",
    documentId: null,
    fileId: "file",
    token: 1,
  },
  closeArtifactPreview: vi.fn(),
}));

vi.mock("@repo/api", async (load) => ({ ...(await load()), ...api }));
vi.mock("@repo/editors/code-editor", () => ({
  CodeEditor: (props: {
    value?: string;
    readOnly?: boolean;
    onChange?: (value: string) => void;
    onSave?: () => void;
  }) => (
    <div>
      <textarea
        aria-label="源码"
        value={props.value}
        readOnly={props.readOnly}
        onChange={(event) => props.onChange?.(event.target.value)}
      />
      <button type="button" onClick={props.onSave}>
        编辑器保存
      </button>
    </div>
  ),
}));
vi.mock("@repo/editors/markdown-editor", () => ({
  MarkdownEditor: (props: { value: string; onChange: (value: string) => void }) => (
    <textarea
      aria-label="源码"
      data-testid="markdown-editor"
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  ),
}));
vi.mock("../store/useChatStore", () => ({
  useChatStore: (selector: (state: typeof store) => unknown) => selector(store),
}));
vi.mock("./ChatArtifactPreview", () => ({ ChatArtifactPreview: () => <div>已保存预览</div> }));

import { ChatFileArtifactPanel } from "./ChatFileArtifactPanel";

const file = {
  id: "file",
  conversation_id: "conversation",
  asset_id: "asset",
  revision_id: "revision",
  title: "Notes",
  filename: "notes.md",
  mime_type: "text/markdown",
  size: 4,
  sha256: "old",
  kind: "artifact" as const,
  editable: true,
  edit_max_bytes: 2097152,
  etag: '"11111111111111111111111111111111"',
  last_writer: { type: "agent" as const, id: "run" },
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("editable conversation file panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchConversationFile.mockResolvedValue(file);
    api.createStorageDownloadUrl.mockResolvedValue({ url: "https://storage.test/file", filename: "notes.md" });
    api.fetchAssetText.mockResolvedValue("old\n");
  });

  it("keeps raw HTML Markdown in the MarkdownEditor", async () => {
    api.fetchAssetText.mockResolvedValue("<details><summary>Title</summary>Body</details>\n");
    render(<ChatFileArtifactPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑文件" }));
    expect(await screen.findByTestId("markdown-editor")).toBeTruthy();
    expect(api.updateConversationFileContent).not.toHaveBeenCalled();
  });

  it("does not replace the Markdown editor when formatting emits HTML", async () => {
    render(<ChatFileArtifactPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑文件" }));
    const original = await screen.findByTestId("markdown-editor");
    fireEvent.change(original, { target: { value: "**<u>underlined</u>**" } });
    expect(screen.getByTestId("markdown-editor")).toBe(original);
    fireEvent.change(original, { target: { value: '<span style="color: red">formatted</span>' } });
    expect(screen.getByTestId("markdown-editor")).toBe(original);
  });

  it("reopens saved underlined Markdown in the rich editor", async () => {
    api.fetchAssetText.mockResolvedValue("**<u>underlined</u>**");
    render(<ChatFileArtifactPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑文件" }));
    expect(await screen.findByTestId("markdown-editor")).toBeTruthy();
  });

  it("uses the editable CodeEditor after switching a code file into edit mode", async () => {
    api.fetchConversationFile.mockResolvedValue({ ...file, filename: "script.js", mime_type: "text/javascript" });
    api.createStorageDownloadUrl.mockResolvedValue({ url: "https://storage.test/file", filename: "script.js" });
    render(<ChatFileArtifactPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑文件" }));
    expect((await screen.findByRole("textbox", { name: "源码" })).hasAttribute("readonly")).toBe(false);
  });

  it("blocks route changes until the user discards the draft", async () => {
    const router = createMemoryRouter([
      { path: "/", element: <ChatFileArtifactPanel /> },
      { path: "/next", element: <div>Next page</div> },
    ]);
    render(<RouterProvider router={router} />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑文件" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "源码" }), { target: { value: "unsaved" } });
    await act(async () => {
      await router.navigate("/next");
    });
    expect(await screen.findByText("保存对文件的修改？")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    await act(async () => {
      await router.navigate("/next");
    });
    fireEvent.click(await screen.findByRole("button", { name: "放弃修改" }));
    expect(await screen.findByText("Next page")).toBeTruthy();
  });

  it("does not mark later keystrokes saved when an older draft commits", async () => {
    let finish!: (value: typeof file) => void;
    api.updateConversationFileContent.mockReturnValueOnce(
      new Promise<typeof file>((resolve) => {
        finish = resolve;
      }),
    );
    render(<ChatFileArtifactPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑文件" }));
    const editor = await screen.findByRole("textbox", { name: "源码" });
    fireEvent.change(editor, { target: { value: "first\n" } });
    fireEvent.click(screen.getByRole("button", { name: "保存文件" }));
    fireEvent.change(editor, { target: { value: "second\n" } });
    finish({
      ...file,
      asset_id: "asset",
      revision_id: "revision-2",
      etag: '"22222222222222222222222222222222"',
      updated_at: "2026-01-01T00:01:00.000Z",
    });
    expect(await screen.findByText("未保存")).toBeTruthy();
    expect(api.updateConversationFileContent).toHaveBeenCalledWith(
      "conversation",
      "file",
      expect.objectContaining({ content: "first\n", expected_etag: file.etag }),
    );
    api.updateConversationFileContent.mockResolvedValueOnce({
      ...file,
      etag: '"33333333333333333333333333333333"',
    });
    fireEvent.click(screen.getByRole("button", { name: "保存文件" }));
    await waitFor(() =>
      expect(api.updateConversationFileContent).toHaveBeenLastCalledWith(
        "conversation",
        "file",
        expect.objectContaining({
          content: "second\n",
          expected_etag: '"22222222222222222222222222222222"',
        }),
      ),
    );
  });

  it("offers save, discard, or cancel before closing a dirty file", async () => {
    const onClose = vi.fn();
    render(<ChatFileArtifactPanel onClose={onClose} />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑文件" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "源码" }), { target: { value: "dirty\n" } });
    fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
    expect(await screen.findByRole("heading", { name: "保存对文件的修改？" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
    fireEvent.click(await screen.findByRole("button", { name: "放弃修改" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("loads editing bytes only on demand and uses the MarkdownEditor", async () => {
    render(<ChatFileArtifactPanel />);
    const edit = await screen.findByRole("button", { name: "编辑文件" });
    expect(api.fetchAssetText).not.toHaveBeenCalled();
    fireEvent.click(edit);
    expect(await screen.findByTestId("markdown-editor")).toBeTruthy();
    expect(api.updateConversationFileContent).not.toHaveBeenCalled();
  });
});
