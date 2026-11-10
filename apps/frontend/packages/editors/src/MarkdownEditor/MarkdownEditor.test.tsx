import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { type AnyExtension, Editor, type JSONContent } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { MarkdownManager } from "@tiptap/markdown";
import { NodeSelection } from "@tiptap/pm/state";
import { CellSelection, columnResizingPluginKey } from "@tiptap/pm/tables";
import StarterKit from "@tiptap/starter-kit";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarkdownEditor } from "./components/Editor";
import { replaceLinkText, resolveLinkFromElement } from "./components/Link/LinkMenu";
import { blockDragPluginKey, createBlockDragExtension, getBlockDragState } from "./extensions/BlockDrag";
import { createImageExtension } from "./extensions/Image";
import { createPasteFlattenExtension } from "./extensions/Paste";
import {
  createTableCellExtension,
  createTableExtension,
  createTableHeaderExtension,
  createTableRowExtension,
} from "./extensions/Table";
import { type AiPolishCallback, type MarkdownEditorRef, RewriteActionType } from "./interface";
import { applyBlocksToSelection, extractSelectionToBlocks, insertBlocksAfterSelection, parseSSEStream } from "./utils";

const compactFeatures = { blockDrag: false, blockMenu: false, codeBlock: false } as const;
const editors: Editor[] = [];

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);
vi.stubGlobal("scrollBy", vi.fn());

Object.defineProperties(URL, {
  createObjectURL: { configurable: true, value: vi.fn(() => "blob:test") },
  revokeObjectURL: { configurable: true, value: vi.fn() },
});

Object.defineProperties(Range.prototype, {
  getBoundingClientRect: { configurable: true, value: () => new DOMRect(0, 0, 100, 20) },
  getClientRects: { configurable: true, value: () => [new DOMRect(0, 0, 100, 20)] },
});
Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => document.body });

afterEach(() => {
  for (const editor of editors) {
    editor.destroy();
  }
  editors.length = 0;
});

function createEditor(options: ConstructorParameters<typeof Editor>[0]) {
  const editor = new Editor(options);
  editors.push(editor);
  return editor;
}

function createTableEditorExtensions(additionalExtensions: AnyExtension[] = []): AnyExtension[] {
  const extensions: AnyExtension[] = [StarterKit, ...additionalExtensions];
  extensions.push(
    createTableExtension({ getCellExtensions: () => extensions }),
    createTableRowExtension(),
    createTableHeaderExtension(),
    createTableCellExtension(),
  );
  return extensions;
}

function createSSEStream(...contents: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const content of contents) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
      }
      controller.close();
    },
  });
}

describe("MarkdownEditor content and lifecycle", () => {
  it("round-trips JSON string content as a TipTap document", async () => {
    const value = JSON.stringify({
      type: "doc",
      content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Title" }] }],
    });
    const ref = createRef<MarkdownEditorRef>();

    render(<MarkdownEditor ref={ref} features={compactFeatures} value={value} contentType="json" />);

    await waitFor(() => expect(ref.current?.editor).not.toBeNull());
    expect(ref.current?.editor?.getJSON()).toMatchObject({
      content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Title" }] }],
    });
  });

  it("keeps the editor instance, draft, selection history when runtime props change", async () => {
    const ref = createRef<MarkdownEditorRef>();
    const view = render(
      <MarkdownEditor
        ref={ref}
        features={compactFeatures}
        defaultValue="<p>original</p>"
        placeholder="First"
        editable={false}
      />,
    );
    await waitFor(() => expect(ref.current?.editor).not.toBeNull());
    const editor = ref.current!.editor!;

    act(() => {
      editor.commands.setContent("<p>edited</p>");
    });
    expect(editor.can().undo()).toBe(true);

    view.rerender(
      <MarkdownEditor
        ref={ref}
        features={compactFeatures}
        defaultValue="<p>original</p>"
        placeholder="Second"
        editable
      />,
    );

    await waitFor(() => expect(ref.current?.editor?.isEditable).toBe(true));
    expect(ref.current?.editor).toBe(editor);
    expect(editor.getText()).toBe("edited");
    expect(editor.can().undo()).toBe(true);
  });

  it("uses the latest upload callback without rebuilding the editor", async () => {
    const ref = createRef<MarkdownEditorRef>();
    const firstUpload = vi.fn(async () => "https://example.com/first.png");
    const latestUpload = vi.fn(async () => "https://example.com/latest.png");
    const view = render(<MarkdownEditor ref={ref} features={compactFeatures} editable onUpload={firstUpload} />);
    await waitFor(() => expect(ref.current?.editor).not.toBeNull());
    const editor = ref.current!.editor!;

    view.rerender(<MarkdownEditor ref={ref} features={compactFeatures} editable onUpload={latestUpload} />);
    act(() => {
      editor.commands.insertImages([new File(["latest"], "latest.png", { type: "image/png" })]);
    });

    await waitFor(() => expect(latestUpload).toHaveBeenCalledTimes(1));
    expect(firstUpload).not.toHaveBeenCalled();
    expect(ref.current?.editor).toBe(editor);
  });

  it("does not let a replaced image upload overwrite the current image", async () => {
    const ref = createRef<MarkdownEditorRef>();
    let resolveFirst!: (url: string) => void;
    let resolveSecond!: (url: string) => void;
    const upload = vi.fn(
      (file: File) =>
        new Promise<string>((resolve) => {
          if (file.name === "first.png") resolveFirst = resolve;
          else resolveSecond = resolve;
        }),
    );
    render(<MarkdownEditor ref={ref} features={compactFeatures} editable onUpload={upload} />);
    await waitFor(() => expect(ref.current?.editor).not.toBeNull());
    const editor = ref.current!.editor!;

    act(() => {
      editor.commands.insertImages([new File(["first"], "first.png", { type: "image/png" })]);
    });
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));

    let imagePos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "image") {
        imagePos = pos;
        return false;
      }
      return true;
    });
    expect(imagePos).toBeGreaterThanOrEqual(0);
    const secondFile = new File(["second"], "second.png", { type: "image/png" });
    editor.storage.image.pendingFiles.set("second-upload", secondFile);
    act(() => {
      const image = editor.state.doc.nodeAt(imagePos)!;
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(imagePos, undefined, { ...image.attrs, uploadId: "second-upload" }),
      );
    });
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));

    await act(async () => resolveFirst("https://example.com/first.png"));
    expect(editor.state.doc.nodeAt(imagePos)?.attrs.uploadId).toBe("second-upload");

    await act(async () => resolveSecond("https://example.com/second.png"));
    await waitFor(() => expect(editor.state.doc.nodeAt(imagePos)?.attrs.src).toBe("https://example.com/second.png"));
  });

  it("keeps the AI polish panel in the selection BubbleMenu", async () => {
    const ref = createRef<MarkdownEditorRef>();
    const selectedText = "x".repeat(600);
    const view = render(
      <MarkdownEditor
        ref={ref}
        features={compactFeatures}
        defaultValue={`<p>${selectedText}</p>`}
        editable
        onAiPolish={vi.fn(async () => new ReadableStream())}
      />,
    );
    await waitFor(() => expect(ref.current?.editor).not.toBeNull());

    act(() => {
      ref
        .current!.editor!.chain()
        .focus()
        .setTextSelection({ from: 1, to: selectedText.length + 1 })
        .run();
    });
    const polishButton = await view.findByRole("button", { name: "AI 润色" });
    const editorDom = ref.current!.editor!.view.dom;
    fireEvent.mouseDown(editorDom, { button: 0 });
    fireEvent.scroll(window);
    fireEvent.mouseUp(document);
    await waitFor(() =>
      expect(document.querySelector(".markdown-editor-bubble-toolbar")?.classList.contains("translate-y-1/2")).toBe(
        true,
      ),
    );
    fireEvent.click(polishButton);

    const polishInput = await view.findByRole("textbox", { name: "AI 润色指令和结果" });
    expect(polishInput.closest(".markdown-editor-bubble-toolbar")).not.toBeNull();
  });

  it("keeps the AI selection trigger when the formatting toolbar is fixed", async () => {
    const ref = createRef<MarkdownEditorRef>();
    const view = render(
      <MarkdownEditor
        ref={ref}
        features={compactFeatures}
        toolbarMode="fixed"
        defaultValue="<p>hello world</p>"
        editable
        onAiPolish={vi.fn(async () => new ReadableStream())}
      />,
    );
    await waitFor(() => expect(ref.current?.editor).not.toBeNull());

    act(() => {
      ref.current!.editor!.chain().focus().setTextSelection({ from: 1, to: 6 }).run();
    });

    const polishButton = await view.findByRole("button", { name: "AI 润色" });
    expect(polishButton.closest(".markdown-editor-bubble-toolbar")).not.toBeNull();
    expect(view.getByRole("button", { name: "撤销" })).toBeTruthy();
  });

  it("streams an AI rewrite and replaces the original selection", async () => {
    const ref = createRef<MarkdownEditorRef>();
    const onAiPolish = vi.fn(async (_config: Parameters<AiPolishCallback>[0], _signal: AbortSignal) =>
      createSSEStream(JSON.stringify([{ content: "polished", type: "paragraph" }])),
    );
    const view = render(
      <MarkdownEditor
        ref={ref}
        features={compactFeatures}
        defaultValue="<p>hello world</p>"
        editable
        onAiPolish={onAiPolish}
      />,
    );
    await waitFor(() => expect(ref.current?.editor).not.toBeNull());
    act(() => {
      ref.current!.editor!.chain().focus().setTextSelection({ from: 1, to: 6 }).run();
    });

    fireEvent.click(await view.findByRole("button", { name: "AI 润色" }));
    const input = (await view.findByRole("textbox", { name: "AI 润色指令和结果" })) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "make concise" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(onAiPolish).toHaveBeenCalledTimes(1));
    expect(onAiPolish.mock.calls[0][0]).toMatchObject({
      action: RewriteActionType.ChatInDoc,
      command: "make concise",
      selectedContent: [{ content: "hello", type: "paragraph" }],
    });
    await waitFor(() => expect(input.value).toBe("polished"));

    fireEvent.click(view.getByRole("button", { name: "替换" }));
    expect(ref.current!.editor!.getText()).toBe("polished world");
  });

  it("aborts an active AI rewrite when the panel closes", async () => {
    const ref = createRef<MarkdownEditorRef>();
    let requestSignal: AbortSignal | undefined;
    const cancelStream = vi.fn();
    const onAiPolish = vi.fn(async (_config: Parameters<AiPolishCallback>[0], signal: AbortSignal) => {
      requestSignal = signal;
      return new ReadableStream<Uint8Array>({
        cancel() {
          cancelStream();
        },
      });
    });
    const view = render(
      <MarkdownEditor
        ref={ref}
        features={compactFeatures}
        defaultValue="<p>hello world</p>"
        editable
        onAiPolish={onAiPolish}
      />,
    );
    await waitFor(() => expect(ref.current?.editor).not.toBeNull());
    act(() => {
      ref.current!.editor!.chain().focus().setTextSelection({ from: 1, to: 6 }).run();
    });

    fireEvent.click(await view.findByRole("button", { name: "AI 润色" }));
    const input = await view.findByRole("textbox", { name: "AI 润色指令和结果" });
    fireEvent.change(input, { target: { value: "rewrite" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onAiPolish).toHaveBeenCalledTimes(1));

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(requestSignal?.aborted).toBe(true));
    await waitFor(() => expect(cancelStream).toHaveBeenCalledTimes(1));
    expect(view.queryByRole("textbox", { name: "AI 润色指令和结果" })).toBeNull();
  });

  it("keeps partial AI output when generation is stopped", async () => {
    const ref = createRef<MarkdownEditorRef>();
    const cancelStream = vi.fn();
    const encoder = new TextEncoder();
    const onAiPolish = vi.fn(
      async () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '[{"content":"partial' })}\n\n`));
          },
          cancel() {
            cancelStream();
          },
        }),
    );
    const view = render(
      <MarkdownEditor
        ref={ref}
        features={compactFeatures}
        defaultValue="<p>hello world</p>"
        editable
        onAiPolish={onAiPolish}
      />,
    );
    await waitFor(() => expect(ref.current?.editor).not.toBeNull());
    act(() => {
      ref.current!.editor!.chain().focus().setTextSelection({ from: 1, to: 6 }).run();
    });

    fireEvent.click(await view.findByRole("button", { name: "AI 润色" }));
    const input = (await view.findByRole("textbox", { name: "AI 润色指令和结果" })) as HTMLTextAreaElement;
    fireEvent.focus(input);
    fireEvent.click(await view.findByText("润色"));
    await waitFor(() => expect(input.value).toBe("partial"));

    fireEvent.click(view.getByRole("button", { name: "终止" }));

    await waitFor(() => expect(cancelStream).toHaveBeenCalledTimes(1));
    expect(input.value).toBe("partial");
    expect(view.getByText("生成已停止，可重试或重置")).toBeTruthy();
  });

  it("rejects an empty AI response without exposing destructive actions", async () => {
    const ref = createRef<MarkdownEditorRef>();
    const view = render(
      <MarkdownEditor
        ref={ref}
        features={compactFeatures}
        defaultValue="<p>hello world</p>"
        editable
        onAiPolish={vi.fn(async () => new ReadableStream({ start: (controller) => controller.close() }))}
      />,
    );
    await waitFor(() => expect(ref.current?.editor).not.toBeNull());
    act(() => {
      ref.current!.editor!.chain().focus().setTextSelection({ from: 1, to: 6 }).run();
    });

    fireEvent.click(await view.findByRole("button", { name: "AI 润色" }));
    const input = await view.findByRole("textbox", { name: "AI 润色指令和结果" });
    fireEvent.focus(input);
    fireEvent.click(await view.findByText("润色"));

    await view.findByText("AI 润色未返回内容");
    expect(view.queryByRole("button", { name: "替换" })).toBeNull();
    expect(ref.current!.editor!.getText()).toBe("hello world");
  });

  it("inserts AI output as a literal block below the selection", async () => {
    const ref = createRef<MarkdownEditorRef>();
    const onAiPolish = vi.fn(async () =>
      createSSEStream(JSON.stringify([{ content: "<strong>safe</strong>", type: "paragraph" }])),
    );
    const view = render(
      <MarkdownEditor
        ref={ref}
        features={compactFeatures}
        defaultValue="<p>hello world</p>"
        editable
        onAiPolish={onAiPolish}
      />,
    );
    await waitFor(() => expect(ref.current?.editor).not.toBeNull());
    act(() => {
      ref.current!.editor!.chain().focus().setTextSelection({ from: 1, to: 6 }).run();
    });

    fireEvent.click(await view.findByRole("button", { name: "AI 润色" }));
    const input = await view.findByRole("textbox", { name: "AI 润色指令和结果" });
    fireEvent.focus(input);
    fireEvent.click(await view.findByText("润色"));
    await view.findByDisplayValue("<strong>safe</strong>");
    fireEvent.click(view.getByRole("button", { name: /插入/ }));

    expect(ref.current!.editor!.getText({ blockSeparator: "|" })).toBe("hello world|<strong>safe</strong>");
    expect(ref.current!.editor!.getHTML()).toContain("&lt;strong&gt;safe&lt;/strong&gt;");
  });

  it("keeps replace in place but inserts multi-block AI output below the selected blocks", async () => {
    const createResponse = () =>
      createSSEStream(
        JSON.stringify([
          { content: "First AI", type: "paragraph" },
          { content: "Second AI", type: "paragraph" },
        ]),
      );
    const renderEditor = async () => {
      const ref = createRef<MarkdownEditorRef>();
      const view = render(
        <MarkdownEditor
          ref={ref}
          features={compactFeatures}
          defaultValue="<p>first</p><p>second</p><p>tail</p>"
          editable
          onAiPolish={vi.fn(async () => createResponse())}
        />,
      );
      await waitFor(() => expect(ref.current?.editor).not.toBeNull());
      const textNodes: Array<{ from: number; to: number }> = [];
      ref.current!.editor!.state.doc.descendants((node, pos) => {
        if (node.isText) {
          textNodes.push({ from: pos, to: pos + node.nodeSize });
        }
      });
      act(() => {
        ref.current!.editor!.chain().focus().setTextSelection({ from: textNodes[0].from, to: textNodes[1].to }).run();
      });
      fireEvent.click(await view.findByRole("button", { name: "AI 润色" }));
      const input = (await view.findByRole("textbox", { name: "AI 润色指令和结果" })) as HTMLTextAreaElement;
      fireEvent.focus(input);
      fireEvent.click(await view.findByText("润色"));
      await waitFor(() => expect(input.value).toBe("First AI\nSecond AI"));
      return { ref, view };
    };

    const replacement = await renderEditor();
    fireEvent.click(replacement.view.getByRole("button", { name: "替换" }));
    expect(replacement.ref.current!.editor!.getText({ blockSeparator: "|" })).toBe("First AI|Second AI|tail");
    replacement.view.unmount();

    const insertion = await renderEditor();
    fireEvent.click(insertion.view.getByRole("button", { name: /插入/ }));
    expect(insertion.ref.current!.editor!.getText({ blockSeparator: "|" })).toBe(
      "first|second|First AI|Second AI|tail",
    );
  });
});

describe("MarkdownEditor editing transactions", () => {
  it("uses the native selection when pasting inside a list", () => {
    const editor = createEditor({
      extensions: [StarterKit, createPasteFlattenExtension()],
      content: "<ul><li><p>hello</p></li><li><p>world</p></li></ul>",
    });
    editor.commands.setTextSelection({ from: 3, to: 8 });

    editor.view.pasteText("REPLACED", new Event("paste") as ClipboardEvent);

    expect(editor.getHTML()).toContain("<li><p>REPLACED</p></li>");
    expect(editor.getText()).not.toContain("hello");
  });

  it("only consumes image paste when an upload was started", () => {
    const editor = createEditor({
      extensions: [StarterKit, createImageExtension(), createPasteFlattenExtension()],
      content: "<p>hello</p>",
    });
    editor.commands.setTextSelection(6);
    const file = new File(["data"], "example.png", { type: "image/png" });
    const event = new Event("paste");
    Object.defineProperty(event, "clipboardData", {
      value: { getData: () => "", items: [{ kind: "file", getAsFile: () => file }] },
    });

    editor.view.pasteHTML('<img src="https://example.com/image.png">', event as ClipboardEvent);

    expect(editor.getHTML()).toContain('src="https://example.com/image.png"');
  });

  it("preserves table pipes, literal backslashes, images and valid cell blocks", () => {
    const manager = new MarkdownManager({
      extensions: createTableEditorExtensions([Image]),
    });
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "A|B" }] }],
                },
                {
                  type: "tableHeader",
                  content: [{ type: "paragraph", content: [{ type: "text", text: String.raw`hello\nworld` }] }],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    { type: "paragraph", content: [{ type: "image", attrs: { src: "https://example.com/a.png" } }] },
                  ],
                },
                { type: "tableCell", content: [{ type: "paragraph" }] },
              ],
            },
          ],
        },
      ],
    };

    const markdown = manager.serialize(doc);
    const parsed = manager.parse(markdown);

    expect(markdown).toContain(String.raw`A\|B`);
    expect(markdown).toContain(String.raw`hello\\\\nworld`);
    expect(markdown).toContain("![");
    expect(JSON.stringify(parsed)).toContain("https://example.com/a.png");
    expect(parsed.content?.[0]?.content?.[0]?.content?.[1]?.content?.[0]?.content?.[0]?.text).toBe(
      String.raw`hello\nworld`,
    );
    expect(parsed.content?.[0]?.content?.[1]?.content?.[0]?.content?.[0]?.type).toBe("image");
  });

  it("renders unordered and ordered list blocks when Markdown table content is restored", async () => {
    const extensions = createTableEditorExtensions();
    const content: JSONContent = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "bulletList",
                      content: [
                        {
                          type: "listItem",
                          content: [{ type: "paragraph", content: [{ type: "text", text: "bullet" }] }],
                        },
                      ],
                    },
                    {
                      type: "orderedList",
                      attrs: { start: 3 },
                      content: [
                        {
                          type: "listItem",
                          content: [{ type: "paragraph", content: [{ type: "text", text: "ordered" }] }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const editor = createEditor({ extensions, content });

    const json = editor.getJSON() as JSONContent;
    const cellContent = json.content?.[0].content?.[0].content?.[0].content;
    expect(cellContent?.map((node) => node.type)).toEqual(["bulletList", "orderedList"]);
    expect(cellContent?.[1]).toMatchObject({ type: "orderedList", attrs: { start: 3 } });

    const restored = createEditor({ extensions, content: editor.getHTML() });
    const restoredJson = restored.getJSON() as JSONContent;
    const restoredCellContent = restoredJson.content?.[0].content?.[0].content?.[0].content;
    expect(restoredCellContent?.map((node) => node.type)).toEqual(["bulletList", "orderedList"]);
    expect(restoredCellContent?.[0].content?.[0].content?.[0].content?.[0]?.text).toBe("bullet");
    expect(restoredCellContent?.[1]).toMatchObject({ type: "orderedList", attrs: { start: 3 } });
    expect(restoredCellContent?.[1].content?.[0].content?.[0].content?.[0]?.text).toBe("ordered");

    const manager = new MarkdownManager({ extensions });
    const serializedMarkdown = manager.serialize(content);
    const markdownRestored = manager.parse(serializedMarkdown);
    const markdownCellContent = markdownRestored.content?.[0].content
      ?.flatMap((row) => row.content ?? [])
      .find((cell) => cell.type === "tableCell")?.content;
    expect(markdownCellContent?.map((node) => node.type)).toEqual(["bulletList", "orderedList"]);
    expect(markdownCellContent?.[1]).toMatchObject({ type: "orderedList", attrs: { start: 3 } });

    const ref = createRef<MarkdownEditorRef>();
    render(
      <MarkdownEditor ref={ref} features={compactFeatures} contentType="markdown" defaultValue={serializedMarkdown} />,
    );
    await waitFor(() => expect(ref.current?.editor).not.toBeNull());

    const renderedTableCell = ref.current!.editor!.view.dom.querySelector("td");
    expect(renderedTableCell?.querySelector("ul")?.textContent).toBe("bullet");
    expect(renderedTableCell?.querySelector("ol")?.getAttribute("start")).toBe("3");
    expect(renderedTableCell?.querySelector("ol")?.textContent).toBe("ordered");
  });

  it("renders table selection grips and the active column resize handle", () => {
    const editor = createEditor({
      extensions: createTableEditorExtensions(),
      content: "<table><tbody><tr><th>A</th><th>B</th></tr><tr><td>C</td><td>D</td></tr></tbody></table>",
    });
    let firstCellPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (firstCellPos === -1 && (node.type.name === "tableHeader" || node.type.name === "tableCell")) {
        firstCellPos = pos;
      }
    });

    editor.commands.setTextSelection(firstCellPos + 1);

    expect(editor.view.dom.querySelectorAll(".markdown-editor-table-grip-row")).toHaveLength(2);
    expect(editor.view.dom.querySelectorAll(".markdown-editor-table-grip-column")).toHaveLength(2);
    expect(editor.view.dom.querySelectorAll(".markdown-editor-table-grip-table")).toHaveLength(1);

    editor.view.dom
      .querySelector<HTMLButtonElement>('button[aria-label="选择第 1 行"]')!
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(editor.state.selection).toBeInstanceOf(CellSelection);
    expect((editor.state.selection as CellSelection).isRowSelection()).toBe(true);

    editor.view.dom
      .querySelector<HTMLButtonElement>('button[aria-label="选择第 1 列"]')!
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect((editor.state.selection as CellSelection).isColSelection()).toBe(true);

    editor.view.dom
      .querySelector<HTMLButtonElement>('button[aria-label="选择整张表格"]')!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect((editor.state.selection as CellSelection).isRowSelection()).toBe(true);
    expect((editor.state.selection as CellSelection).isColSelection()).toBe(true);

    editor.view.dispatch(editor.state.tr.setMeta(columnResizingPluginKey, { setHandle: firstCellPos }));
    expect(editor.view.dom.querySelectorAll(".column-resize-handle")).toHaveLength(2);
    expect(editor.view.dom.classList.contains("resize-cursor")).toBe(true);
  });

  it("merges whole-table selection and block dragging into one hover control", async () => {
    const ref = createRef<MarkdownEditorRef>();
    const view = render(
      <MarkdownEditor
        ref={ref}
        editable
        features={{ blockDrag: true, blockMenu: false, codeBlock: false }}
        defaultValue="<p>before</p><table><tbody><tr><th>A</th><th>B</th></tr><tr><td>C</td><td>D</td></tr></tbody></table>"
      />,
    );
    await waitFor(() => expect(ref.current?.editor).not.toBeNull());
    const editor = ref.current!.editor!;
    let tablePos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "table") {
        tablePos = pos;
        return false;
      }
      return true;
    });
    expect(tablePos).toBeGreaterThan(0);
    const tableWrapper = editor.view.dom.querySelector<HTMLElement>(".tableWrapper")!;
    const table = tableWrapper.querySelector<HTMLTableElement>("table")!;
    vi.spyOn(editor.view.dom, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 0, 700, 600));
    vi.spyOn(tableWrapper, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 100, 500, 240));
    vi.spyOn(table, "getBoundingClientRect").mockReturnValue(new DOMRect(128, 124, 472, 216));

    fireEvent.mouseMove(table, { clientX: 200, clientY: 160 });

    const selectButton = await view.findByRole("button", { name: "选择整张表格" });
    const dragButton = view.getByRole("button", { name: "拖拽表格" });
    expect(editor.view.dom.querySelector(".markdown-editor-table-grip-table")).toBeNull();

    fireEvent.mouseDown(selectButton);
    fireEvent.click(selectButton);
    expect(editor.state.selection).toBeInstanceOf(CellSelection);
    expect((editor.state.selection as CellSelection).isRowSelection()).toBe(true);
    expect((editor.state.selection as CellSelection).isColSelection()).toBe(true);

    const dataTransfer = {
      clearData: vi.fn(),
      effectAllowed: "none",
      setData: vi.fn(),
      setDragImage: vi.fn(),
    } as unknown as DataTransfer;
    fireEvent.dragStart(dragButton, { dataTransfer });
    expect(getBlockDragState(editor).draggingBlockPos).toBe(tablePos);
    expect(dataTransfer.effectAllowed).toBe("move");
    expect(dataTransfer.setDragImage).toHaveBeenCalledWith(tableWrapper, 0, 0);
    fireEvent.dragEnd(dragButton, { dataTransfer });
  });

  it("uses one command transaction and cancels dragend without moving content", () => {
    const editor = createEditor({
      extensions: [StarterKit, createBlockDragExtension()],
      content: "<p>AAA</p><p>BBB</p><p>CCC</p>",
    });
    const initial = editor.getJSON();

    expect(editor.commands.startBlockDrag(0)).toBe(true);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    editor.view.dispatch(editor.state.tr.setMeta(blockDragPluginKey, { dropTarget: { pos: 10, placement: "after" } }));
    editor.view.dom.dispatchEvent(new Event("dragend", { bubbles: true }));

    expect(editor.getJSON()).toEqual(initial);
    expect(getBlockDragState(editor).draggingBlockPos).toBeNull();
  });

  it("rejects nested blocks as drag sources", () => {
    const editor = createEditor({
      extensions: [StarterKit, createBlockDragExtension()],
      content: "<ul><li><p>nested</p></li></ul><p>top level</p>",
    });
    let nestedParagraphPos = -1;
    editor.state.doc.descendants((node, pos, parent) => {
      if (node.type.name === "paragraph" && parent?.type.name === "listItem") {
        nestedParagraphPos = pos;
        return false;
      }
      return true;
    });

    expect(nestedParagraphPos).toBeGreaterThan(0);
    expect(editor.commands.startBlockDrag(nestedParagraphPos)).toBe(false);
    expect(getBlockDragState(editor)).toEqual({
      activeBlockPos: null,
      draggingBlockPos: null,
      dropTarget: null,
    });
  });

  it("resolves adjacent links exactly and inserts edited labels as text", () => {
    const editor = createEditor({
      extensions: [StarterKit],
      content: '<p><a href="https://a.example">A</a><a href="https://b.example">BB</a></p>',
    });
    const links = editor.view.dom.querySelectorAll<HTMLAnchorElement>("a");
    const first = resolveLinkFromElement(editor, links[0]);
    const second = resolveLinkFromElement(editor, links[1]);

    expect(first && editor.state.doc.textBetween(first.range.from, first.range.to)).toBe("A");
    expect(second && editor.state.doc.textBetween(second.range.from, second.range.to)).toBe("BB");

    editor.view.dispatch(editor.state.tr.removeMark(first!.range.from, first!.range.to, first!.mark.type));
    expect(editor.getHTML()).toContain('href="https://b.example"');
    expect(editor.getHTML()).not.toContain('href="https://a.example"');

    const remainingLinkElement = editor.view.dom.querySelector<HTMLAnchorElement>("a")!;
    const remainingLink = resolveLinkFromElement(editor, remainingLinkElement)!;
    replaceLinkText(editor, remainingLink.range, remainingLink.mark, "<strong>label</strong>", "https://new.example");
    expect(editor.getText()).toContain("A<strong>label</strong>");
    expect(editor.getHTML()).toContain("&lt;strong&gt;label&lt;/strong&gt;");
    expect(editor.getHTML()).toContain('href="https://new.example"');
  });

  it("keeps distinct marks separate and rejects stale AI replacements", () => {
    const editor = createEditor({ extensions: [StarterKit], content: "<p><strong>bold</strong> normal</p>" });
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
    const snapshot = extractSelectionToBlocks(editor);

    expect(snapshot.blocks).toHaveLength(2);
    expect(snapshot.blocks[0].marks.map((mark) => mark.type.name)).toContain("bold");
    expect(snapshot.blocks[1].marks).toHaveLength(0);
    expect(
      applyBlocksToSelection(
        editor,
        snapshot,
        snapshot.blocks.map((block) => block.text),
      ),
    ).toBe(true);
    expect(editor.getJSON().content?.[0].content?.[0].marks?.[0].type).toBe("bold");
    expect(editor.getJSON().content?.[0].content?.[1].marks).toBeUndefined();

    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
    const staleSnapshot = extractSelectionToBlocks(editor);
    editor.commands.insertContentAt(editor.state.doc.content.size, "changed");
    expect(
      applyBlocksToSelection(
        editor,
        staleSnapshot,
        staleSnapshot.blocks.map((block) => block.text),
      ),
    ).toBe(false);
    expect(editor.getText()).toContain("bold normal");
  });

  it("groups styled runs into one text block when inserting AI output", () => {
    const editor = createEditor({
      extensions: [StarterKit],
      content: "<p><strong>bold</strong> normal tail</p><p>end</p>",
    });
    editor.commands.setTextSelection({ from: 1, to: 12 });
    const snapshot = extractSelectionToBlocks(editor);

    expect(snapshot.blocks).toHaveLength(2);
    expect(insertBlocksAfterSelection(editor, snapshot, ["B", "N"])).toBe(true);
    expect(editor.getHTML()).toBe("<p><strong>bold</strong> normal tail</p><p><strong>B</strong>N</p><p>end</p>");
  });

  it("parses CRLF SSE events and the final event without a blank terminator", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"content":"first"}\r\n\r\ndata: {"content":"second"}'));
        controller.close();
      },
    });
    const contents: string[] = [];

    for await (const content of parseSSEStream(stream)) {
      contents.push(content);
    }

    expect(contents).toEqual(["first", "second"]);
  });
});
