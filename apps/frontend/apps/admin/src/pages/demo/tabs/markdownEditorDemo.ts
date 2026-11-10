import {
  type AiPolishCallback,
  type ContentType,
  RewriteActionType,
  type MarkdownEditorRef,
} from "@repo/editors/markdown-editor";

export const markdownEditorDemo = String.raw`# MarkdownEditor 全能力演示

> 默认使用 Markdown 保存与回填。选中文本后，可从气泡工具栏启动 AI 润色。

## 常用块与行内格式

- **粗体**、*斜体*、~~删除线~~与行内格式
- [外部链接](https://tiptap.dev/) 与引用
- 可通过上方开关体验固定 / 气泡工具栏、只读和块级能力

> 这是一个引用块，用于验证 Markdown 往返。

~~~ts
const editor = "TipTap 3.33.0";
~~~

## Table cell 内的 block

下面单元格包含段落、无序列表和有序列表。编辑后查看底部 Markdown 输出，再切换模式回来验证回填。

| 场景 | Cell 内容 |
| --- | --- |
| 列表 block | **Cell 标题**\n\n- 无序项 A\n- 无序项 B\n\n1. 有序项 A\n2. 有序项 B |
| 转义内容 | 管道字符 A\|B\n\n字面反斜杠：\\n |

## 任务清单

- [x] Markdown 表格 cell block 往返
- [x] AI 流式润色、停止与重试
- [ ] 继续输入并体验拖拽、链接、图片和代码块
`;

type EditorInstance = NonNullable<MarkdownEditorRef["editor"]>;

export const serializeEditorForDemo = (editor: EditorInstance, contentType: ContentType): string => {
  if (contentType === "markdown") {
    return editor.getMarkdown();
  }
  if (contentType === "json") {
    return JSON.stringify(editor.getJSON(), null, 2);
  }
  return editor.getHTML();
};

const rewriteText = (content: string, action: RewriteActionType, command: string): string => {
  switch (action) {
    case RewriteActionType.Expansion:
      return `${content}。这里补充了更完整的背景、目标和结果说明。`;
    case RewriteActionType.Abbreviation:
      return content.length > 20 ? `${content.slice(0, 20)}…` : content;
    case RewriteActionType.ChatInDoc:
      return `${content}（已按“${command}”调整）`;
    case RewriteActionType.Polish:
      return `润色后：${content}`;
  }
};

const encoder = new TextEncoder();

export const demoAiPolish: AiPolishCallback = async ({ action, command, selectedContent }, signal) => {
  const result = JSON.stringify(
    selectedContent.map((block) => ({
      content: rewriteText(block.content, action, command),
      type: block.type,
    })),
  );
  const chunks = result.match(/.{1,12}/gs) ?? [];
  let cancelled = false;
  let index = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 35);
      });
      if (cancelled) {
        return;
      }
      if (signal.aborted) {
        controller.error(new DOMException("AI 润色已中断", "AbortError"));
        return;
      }

      const chunk = chunks[index];
      if (chunk === undefined) {
        controller.close();
        return;
      }

      index += 1;
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: chunk })}\n\n`));
    },
    cancel() {
      cancelled = true;
    },
  });
};
