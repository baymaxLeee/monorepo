import { Dialog, DialogContent, DialogTitle } from "@repo/design-system";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { beforeAll, afterAll, expect, test, vi } from "vitest";

import type { PromptInputRef, PromptInputValue } from "../interface";
import Editor from "./Editor";

test("empty draft exposes placeholder state without covering entered text", async () => {
  const ref = createRef<PromptInputRef>();
  render(<Editor ref={ref} />);
  const input = await screen.findByRole("textbox", { name: "消息" });
  await waitFor(() => expect(input.dataset.empty).toBe("true"));
  act(() => ref.current?.editor?.commands.insertContent("正文"));
  expect(input.dataset.empty).toBe("false");
  act(() => ref.current?.clear());
  expect(input.dataset.empty).toBe("true");
});

// ProseMirror measures DOM ranges; jsdom has no layout implementation.
beforeAll(() => {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect() });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});
afterAll(() => {
  delete (Range.prototype as Partial<Range>).getClientRects;
  delete (Range.prototype as Partial<Range>).getBoundingClientRect;
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});

test("mention popup inside a dialog retains editor focus and selects with keyboard", async () => {
  const ref = createRef<PromptInputRef>();
  const submit = vi.fn();
  render(
    <Dialog defaultOpen>
      <DialogContent>
        <DialogTitle>编辑消息</DialogTitle>
        <Editor
          ref={ref}
          mentionSource={() => [
            { id: "one", label: "第一份文件" },
            { id: "two", label: "第二份文件" },
          ]}
          onSubmit={submit}
        />
      </DialogContent>
    </Dialog>,
  );
  const input = await screen.findByRole("combobox", { name: "消息" });
  await waitFor(() => expect(ref.current?.editor).toBeTruthy());
  act(() => {
    input.focus();
    ref.current?.editor?.commands.insertContent("@");
  });
  const list = await screen.findByRole("listbox", { name: "输入建议" });
  expect(input.getAttribute("aria-controls")).toBe(list.id);
  expect(input.getAttribute("aria-expanded")).toBe("true");
  expect(list.closest('[data-slot="popover-content"]')?.parentElement?.style.zIndex).toBe("1050");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  await waitFor(() =>
    expect(document.getElementById(input.getAttribute("aria-activedescendant") ?? "")?.textContent).toContain(
      "第二份文件",
    ),
  );
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(ref.current?.getValue().tokens[0]?.id).toBe("two"));
  expect(submit).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(input);
  expect(input.getAttribute("aria-expanded")).toBe("false");
});

test("upload retry changes generic state and removal releases preview resources", async () => {
  const ref = createRef<PromptInputRef>();
  const added = vi.fn();
  const create = vi.fn(() => "blob:preview");
  const revoke = vi.fn();
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: revoke }));
  try {
    const view = render(<Editor ref={ref} onFilesAdded={added} />);
    await waitFor(() => expect(ref.current?.editor).toBeTruthy());
    act(() => ref.current?.insertFiles([new File(["image"], "photo.png", { type: "image/png" })]));
    const token = ref.current!.getValue().tokens[0]!;
    expect(token.status).toBe("uploading");
    act(() => ref.current?.updateToken(token.id, { status: "failed", error: "network" }));
    fireEvent.click(await screen.findByRole("button", { name: "重试上传 photo.png" }));
    expect(ref.current!.getValue().tokens[0]!.status).toBe("uploading");
    expect(added).toHaveBeenCalledTimes(2);
    fireEvent.click(await screen.findByRole("button", { name: "移除 photo.png" }));
    expect(ref.current!.getValue().files).toEqual({});
    expect(revoke).toHaveBeenCalledWith("blob:preview");
    view.unmount();
    expect(revoke).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("composer has a name, retains draft during generation and offers stop", async () => {
  const stop = vi.fn();
  const submit = vi.fn();
  const { rerender } = render(<Editor defaultValue="草稿" onSubmit={submit} />);
  const input = await screen.findByRole("textbox", { name: "消息" });
  expect(input.getAttribute("aria-multiline")).toBe("true");
  rerender(<Editor defaultValue="草稿" loading onStop={stop} onSubmit={submit} />);
  expect(input.getAttribute("contenteditable")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "停止生成" }));
  expect(stop).toHaveBeenCalledTimes(1);
  expect(submit).not.toHaveBeenCalled();
  expect(input.textContent).toBe("草稿");
});

test("IME confirmation does not send, plain Enter sends once", async () => {
  const submit = vi.fn();
  render(<Editor defaultValue="中文" onSubmit={submit} />);
  const input = await screen.findByRole("textbox", { name: "消息" });
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  fireEvent.keyDown(input, { key: "Enter", keyCode: 229, ctrlKey: true });
  expect(submit).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(submit).toHaveBeenCalledTimes(1);
});

test("draft restoration preserves inline tokens and empty lines", async () => {
  const ref = createRef<PromptInputRef>();
  render(<Editor ref={ref} />);
  await waitFor(() => expect(ref.current?.editor).toBeTruthy());
  const token = { id: "file", kind: "file", label: "附件", status: "ready" as const };
  const draft: PromptInputValue = {
    text: "查看 [[file]]\n\n然后解释",
    segments: [
      { type: "text", text: "查看 " },
      { type: "token", token },
      { type: "text", text: "\n\n然后解释" },
    ],
    tokens: [token],
    files: {},
  };
  act(() => ref.current?.setValue(draft));
  expect(ref.current?.getValue().text).toBe(draft.text);
});

test("failed attachments block submit without destroying the draft", async () => {
  const ref = createRef<PromptInputRef>();
  const submit = vi.fn();
  const error = vi.fn();
  render(<Editor ref={ref} onSubmit={submit} onError={error} />);
  await waitFor(() => expect(ref.current?.editor).toBeTruthy());
  const token = { id: "file", kind: "file", label: "附件", status: "failed" as const, error: "网络失败" };
  act(() =>
    ref.current?.setValue({ text: "[[file]]", segments: [{ type: "token", token }], tokens: [token], files: {} }),
  );
  fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
  expect(error).toHaveBeenCalledWith(expect.stringContaining("上传失败"));
  expect(submit).not.toHaveBeenCalled();
  expect(ref.current?.getValue().tokens).toHaveLength(1);
});

test("text-only composers hide attachment actions", () => {
  render(<Editor maxFiles={0} />);
  expect(screen.queryByRole("button", { name: "添加附件" })).toBeNull();
});
