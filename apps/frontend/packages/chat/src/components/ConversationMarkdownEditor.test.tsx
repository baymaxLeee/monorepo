import { MarkdownEditor, type MarkdownEditorRef } from "@repo/editors/markdown-editor";
import { act, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { expect, it, vi } from "vitest";

it("does not rewrite Markdown on mount and preserves links, tables and code after editing", async () => {
  const ref = createRef<MarkdownEditorRef>();
  const onChange = vi.fn();
  const original =
    '# Notes\n\n[Link](https://example.com)\n\n| A | B |\n| --- | --- |\n| one | two |\n\n```js\nconst value = "<tag>";\n```\n';
  render(<MarkdownEditor ref={ref} value={original} contentType="markdown" editable onChange={onChange} />);
  await waitFor(() => expect(ref.current?.editor).toBeTruthy(), { timeout: 10_000 });
  expect(onChange).not.toHaveBeenCalled();
  const editor = ref.current!.editor!;
  act(() => {
    editor.commands.insertContentAt(1, "Updated ");
  });
  await waitFor(() => expect(onChange).toHaveBeenCalled());
  const saved = onChange.mock.lastCall![0] as string;
  expect(saved).toContain("Updated Notes");
  expect(saved).toContain("[Link](https://example.com)");
  expect(saved).toContain("one");
  expect(saved).toContain("two");
  expect(saved).toContain('```js\nconst value = "<tag>";\n```');
  expect(editor.getJSON().content?.some((node) => node.type === "table")).toBe(true);
});
