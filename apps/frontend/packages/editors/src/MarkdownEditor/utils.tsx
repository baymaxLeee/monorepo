import type { Editor } from "@tiptap/core";
import { Fragment, Mark, type Node as ProseMirrorNode, type ResolvedPos } from "@tiptap/pm/model";
import type { Selection } from "@tiptap/pm/state";

import { isAllowedImageFile } from "./constants";

/**
 * 带有格式标记的文本块
 * 记录了纯文本内容、样式标记（如加粗、链接）及其属性
 */
export interface StyledTextBlock {
  id: string;
  text: string;
  marks: Mark[];
  type: string;
  from: number;
  to: number;
  textBlockPos: number;
}

/**
 * 选区快照
 * 包含所有文本块和原始选区范围
 */
export interface SelectionSnapshot {
  blocks: StyledTextBlock[];
  doc: ProseMirrorNode;
}

export const isEditorViewUnavailableError = (error: unknown) =>
  error instanceof Error && error.message.includes("The editor view is not available");

export const getMountedEditorDom = (editor: Editor | null | undefined): HTMLElement | null => {
  if (!editor || editor.isDestroyed) {
    return null;
  }

  try {
    return editor.view.dom;
  } catch (error) {
    if (isEditorViewUnavailableError(error)) {
      return null;
    }
    throw error;
  }
};

export const getPortalPosition = (position: { top: number; left: number }, container: HTMLElement) => {
  if (container === document.body || container === document.documentElement) {
    return {
      position: "fixed" as const,
      top: position.top,
      left: position.left,
    };
  }

  const containerRect = container.getBoundingClientRect();
  return {
    position: "absolute" as const,
    top: position.top - containerRect.top + container.scrollTop - container.clientTop,
    left: position.left - containerRect.left + container.scrollLeft - container.clientLeft,
  };
};

/**
 * 提取选区快照
 * 遍历选区内的所有文本节点，将其转换为 StyledTextBlock 数组
 */
export const extractSelectionToBlocks = (editor: Editor): SelectionSnapshot => {
  const { from, to } = editor.state.selection;
  if (from === to) {
    return { blocks: [], doc: editor.state.doc };
  }

  const blocks: StyledTextBlock[] = [];

  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText) {
      const start = Math.max(from, pos);
      const end = Math.min(to, pos + node.nodeSize);

      if (start < end) {
        const $pos = editor.state.doc.resolve(pos);
        const parent = $pos.parent;
        const textBlockPos = $pos.before($pos.depth);
        let type = parent.type.name;

        if (type === "heading") {
          type = `h${parent.attrs.level}`;
        }

        const markNames = node.marks.map((m) => m.type.name);
        if (markNames.includes("link")) {
          type = "link";
        }

        const currentBlock = {
          id: `block_${start}_${end}`,
          text: node.text?.slice(start - pos, end - pos) || "",
          type,
          marks: [...node.marks],
          from: start,
          to: end,
          textBlockPos,
        };

        if (blocks.length > 0) {
          const lastBlock = blocks[blocks.length - 1];
          const mergeableTypes = new Set(["paragraph", "link", "h1", "h2", "h3", "h4", "h5", "h6"]);
          const isContiguous = lastBlock.to === currentBlock.from;
          if (
            lastBlock.type === currentBlock.type &&
            mergeableTypes.has(currentBlock.type) &&
            isContiguous &&
            Mark.sameSet(lastBlock.marks, currentBlock.marks)
          ) {
            lastBlock.text += currentBlock.text;
            lastBlock.to = currentBlock.to;
            lastBlock.id = `block_${lastBlock.from}_${currentBlock.to}`;
          } else {
            blocks.push(currentBlock);
          }
        } else {
          blocks.push(currentBlock);
        }
      }
    }
  });

  return { blocks, doc: editor.state.doc };
};

export const isSelectionSnapshotCurrent = (editor: Editor, snapshot: SelectionSnapshot) =>
  editor.state.doc === snapshot.doc;

/**
 * 应用润色后的文本块
 * 根据快照信息，将新文本数组回填到编辑器中，并保留原有的格式标记
 */
export const applyBlocksToSelection = (editor: Editor, snapshot: SelectionSnapshot, newTexts: string[]): boolean => {
  if (!isSelectionSnapshotCurrent(editor, snapshot)) {
    return false;
  }
  if (!Array.isArray(newTexts) || snapshot.blocks.length !== newTexts.length) {
    console.error("Mismatch between snapshot blocks and new texts");
    return false;
  }

  const tr = editor.state.tr;

  for (let i = snapshot.blocks.length - 1; i >= 0; i--) {
    const block = snapshot.blocks[i];
    const newText = newTexts[i];

    if (newText) {
      const newNode = editor.schema.text(newText, block.marks);

      tr.replaceWith(block.from, block.to, newNode);
    } else {
      tr.delete(block.from, block.to);
    }
  }

  if (tr.docChanged) {
    editor.view.dispatch(tr);
    return true;
  }
  return false;
};

/**
 * 将润色结果作为新的文本块插入到最后一个选中文本块之后。
 * 同一 textblock 中因 marks 不同而拆分的文本会重新组合为一个节点，避免把行内样式片段误拆成多个段落。
 */
export const insertBlocksAfterSelection = (
  editor: Editor,
  snapshot: SelectionSnapshot,
  newTexts: string[],
): boolean => {
  if (!isSelectionSnapshotCurrent(editor, snapshot) || snapshot.blocks.length !== newTexts.length) {
    return false;
  }

  const groups: Array<{ textBlockPos: number; blocks: Array<{ block: StyledTextBlock; text: string }> }> = [];

  snapshot.blocks.forEach((block, index) => {
    const lastGroup = groups.at(-1);
    if (lastGroup?.textBlockPos === block.textBlockPos) {
      lastGroup.blocks.push({ block, text: newTexts[index] });
      return;
    }
    groups.push({ textBlockPos: block.textBlockPos, blocks: [{ block, text: newTexts[index] }] });
  });

  const insertedNodes: ProseMirrorNode[] = [];
  for (const group of groups) {
    const originalTextBlock = snapshot.doc.nodeAt(group.textBlockPos);
    if (!originalTextBlock?.isTextblock) {
      return false;
    }

    const inlineNodes = group.blocks.flatMap(({ block, text }) =>
      text ? [editor.schema.text(text, block.marks)] : [],
    );
    insertedNodes.push(originalTextBlock.copy(Fragment.fromArray(inlineNodes)));
  }

  const lastGroup = groups.at(-1);
  if (!lastGroup) {
    return false;
  }
  const lastTextBlock = snapshot.doc.nodeAt(lastGroup.textBlockPos);
  if (!lastTextBlock?.isTextblock) {
    return false;
  }

  const insertPos = lastGroup.textBlockPos + lastTextBlock.nodeSize;
  const $insert = snapshot.doc.resolve(insertPos);
  const content = Fragment.fromArray(insertedNodes);
  const insertIndex = $insert.index();
  if (!$insert.parent.canReplace(insertIndex, insertIndex, content)) {
    return false;
  }

  const transaction = editor.state.tr.insert(insertPos, content);
  if (!transaction.docChanged) {
    return false;
  }
  editor.view.dispatch(transaction);
  return true;
};

export function getFullUrl(url: string) {
  url = url.trim();
  if (!/^https?:\/\//.test(url)) {
    url = `${globalThis.location.protocol}//${url}`;
  }
  return url;
}

export function isInsideTableCell($pos: ResolvedPos): boolean {
  for (let depth = $pos.depth; depth >= 0; depth -= 1) {
    const nodeName = $pos.node(depth).type.name;
    if (nodeName === "tableCell" || nodeName === "tableHeader") {
      return true;
    }
  }

  return false;
}

export function isSelectionInsideTableCell(selection: Selection): boolean {
  return (
    isInsideTableCell(selection.$from) ||
    isInsideTableCell(selection.$to) ||
    isInsideTableCell(selection.$anchor) ||
    isInsideTableCell(selection.$head)
  );
}

/**
 * 从 SSE ReadableStream 中逐条解析 event，yield 每个 event 的 content 字段。
 * SSE event 格式：data: {"event":"message","content":"..."}
 */
export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let aborted = signal?.aborted ?? false;
  let cancellation: Promise<void> | undefined;

  const abort = () => {
    aborted = true;
    cancellation ??= reader.cancel(signal?.reason).catch(() => {});
  };

  if (aborted) {
    abort();
  } else {
    signal?.addEventListener("abort", abort, { once: true });
  }

  try {
    if (aborted) {
      return;
    }

    for (;;) {
      const { done, value } = await reader.read();
      if (aborted) {
        return;
      }
      if (done) {
        buffer += decoder.decode();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || "";

      for (const event of events) {
        const content = parseSSEEvent(event);
        if (content === null) {
          continue;
        }
        yield content;
      }
    }

    if (aborted) {
      return;
    }
    const content = parseSSEEvent(buffer);
    if (content !== null) {
      yield content;
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    await cancellation;
    reader.releaseLock();
  }
}

const parseSSEEvent = (event: string): string | null => {
  const data = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) {
    return null;
  }

  try {
    const parsed = JSON.parse(data);
    return typeof parsed.content === "string" ? parsed.content : null;
  } catch {
    return null;
  }
};

/**
 * 从构建中的不完整 JSON 字符串（目标格式 [{content,type}]）中提取可读文本。
 * 匹配所有已完成的 "content":"..." 值，以及尾部未闭合的片段。
 */
export function extractTextFromPartialJson(partial: string): string {
  const texts: string[] = [];

  const completeRegex = /"content"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;

  // biome-ignore lint/suspicious/noAssignInExpressions: RegExp.exec 循环惯用法
  while ((match = completeRegex.exec(partial)) !== null) {
    texts.push(unescapeJsonString(match[1]));
    lastIndex = completeRegex.lastIndex;
  }

  const tail = partial.slice(lastIndex);
  const incompleteMatch = tail.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)$/);
  if (incompleteMatch) {
    texts.push(unescapeJsonString(incompleteMatch[1]));
  }

  return texts.join("\n");
}

function unescapeJsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
}

/**
 * 从 paste / drop 事件里提取二进制图片文件。
 * 覆盖 Finder 复制、系统截图（macOS Cmd+Shift+Ctrl+4、Windows Snipping Tool）、
 * 网页拖拽 —— 这些在现代浏览器里都会出现在 DataTransferItemList 中。
 *
 * 只遍历 items（不再从 data.files 兜底），因为 Chrome 会把同一张图同时挂到
 * items 和 files，两次 getAsFile() 可能给出 lastModified 不同的 File，
 * 合并就会出现重复。
 */
export function getClipboardImageFiles(event: ClipboardEvent | DragEvent): File[] {
  const data = "clipboardData" in event ? event.clipboardData : event.dataTransfer;
  if (!data?.items) {
    return [];
  }

  const files: File[] = [];
  for (let i = 0; i < data.items.length; i += 1) {
    const item = data.items[i];
    if (item.kind !== "file") {
      continue;
    }
    const file = item.getAsFile();
    if (file && isAllowedImageFile(file)) {
      files.push(file);
    }
  }
  return files;
}
