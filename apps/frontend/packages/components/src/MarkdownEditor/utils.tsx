import type { Editor } from "@tiptap/core";
import type { Mark, ResolvedPos } from "@tiptap/pm/model";
import type { Selection } from "@tiptap/pm/state";
import { isAllowedImageFile } from "./constants";

/**
 * 带有格式标记的文本块
 * 记录了纯文本内容、样式标记（如加粗、链接）及其属性
 */
export interface StyledTextBlock {
  id: string; // 唯一标识，用于映射
  text: string; // 纯文本内容
  marks: Mark[]; // ProseMirror Mark 对象数组
  type: string;
  from: number; // 原文档中的起始位置
  to: number; // 原文档中的结束位置
}

/**
 * 选区快照
 * 包含所有文本块和原始选区范围
 */
export interface SelectionSnapshot {
  blocks: StyledTextBlock[];
  range: {
    from: number;
    to: number;
  };
}

export const isEditorViewUnavailableError = (error: unknown) =>
  error instanceof Error &&
  error.message.includes("The editor view is not available");

export const getMountedEditorDom = (
  editor: Editor | null | undefined,
): HTMLElement | null => {
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

/**
 * 提取选区快照
 * 遍历选区内的所有文本节点，将其转换为 StyledTextBlock 数组
 */
export const extractSelectionToBlocks = (editor: Editor): SelectionSnapshot => {
  const { from, to } = editor.state.selection;
  if (from === to) return { blocks: [], range: { from, to } };

  const blocks: StyledTextBlock[] = [];

  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText) {
      // 计算当前文本节点在选区内的有效范围（处理选区只覆盖文本节点一部分的情况）
      const start = Math.max(from, pos);
      const end = Math.min(to, pos + node.nodeSize);

      if (start < end) {
        const $pos = editor.state.doc.resolve(pos);
        const parent = $pos.parent;
        let type = parent.type.name;

        if (type === "heading") {
          type = `h${parent.attrs.level}`;
        }

        const markNames = node.marks.map((m) => m.type.name);
        if (markNames.includes("comment")) {
          type = "comment";
        } else if (markNames.includes("link")) {
          type = "link";
        }

        const currentBlock = {
          id: `block_${start}_${end}`,
          text: node.text?.slice(start - pos, end - pos) || "",
          type,
          marks: [...node.marks],
          from: start,
          to: end,
        };

        if (blocks.length > 0) {
          const lastBlock = blocks[blocks.length - 1];
          const mergeableTypes = new Set([
            "paragraph",
            "link",
            "comment",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
          ]);
          const isContiguous = lastBlock.to === currentBlock.from;
          if (
            lastBlock.type === currentBlock.type &&
            mergeableTypes.has(currentBlock.type) &&
            isContiguous
          ) {
            lastBlock.text += currentBlock.text;
            lastBlock.to = currentBlock.to;
            lastBlock.id = `block_${lastBlock.from}_${currentBlock.to}`; // 更新ID以反映新的范围
          } else {
            blocks.push(currentBlock);
          }
        } else {
          blocks.push(currentBlock);
        }
      }
    }
  });

  return { blocks, range: { from, to } };
};

/**
 * 应用润色后的文本块
 * 根据快照信息，将新文本数组回填到编辑器中，并保留原有的格式标记
 */
export const applyBlocksToSelection = (
  editor: Editor,
  snapshot: SelectionSnapshot,
  newTexts: string[],
): boolean => {
  if (!Array.isArray(newTexts) || snapshot.blocks.length !== newTexts.length) {
    console.error("Mismatch between snapshot blocks and new texts");
    return false;
  }

  const tr = editor.state.tr;

  // 关键策略：倒序替换
  // 必须从文档末尾向前替换，这样前面的替换操作不会影响后面节点的位置索引
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
): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const event of events) {
        const dataLine = event
          .split("\n")
          .find((line) => line.startsWith("data:"));
        if (!dataLine) continue;

        const jsonStr = dataLine.slice(5).trim();
        try {
          const parsed = JSON.parse(jsonStr);
          if (typeof parsed.content === "string") {
            yield parsed.content;
          }
        } catch {
          // 忽略不完整 / 非法 JSON 行
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

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
    return raw
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
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
export function getClipboardImageFiles(
  event: ClipboardEvent | DragEvent,
): File[] {
  const data =
    "clipboardData" in event ? event.clipboardData : event.dataTransfer;
  if (!data?.items) return [];

  const files: File[] = [];
  for (let i = 0; i < data.items.length; i += 1) {
    const item = data.items[i];
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file && isAllowedImageFile(file)) files.push(file);
  }
  return files;
}
