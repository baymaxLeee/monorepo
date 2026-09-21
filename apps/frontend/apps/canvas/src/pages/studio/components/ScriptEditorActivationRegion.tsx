import type { ReactNode } from "react";

const MARKDOWN_EDITOR_PORTAL_SELECTOR = '[class*="markdown-editor-"]';

/**
 * MarkdownEditor 的气泡工具栏和二级弹层通过 Portal 挂到 body，DOM 上不在
 * 故事板编辑区内，但仍属于当前编辑会话，不能被当作区域外点击。
 */
export function isScriptEditorInteractionTarget(editorRegion: HTMLElement | null, target: Element) {
  return Boolean(editorRegion?.contains(target) || target.closest(MARKDOWN_EDITOR_PORTAL_SELECTOR));
}

export function ScriptEditorActivationRegion({
  children,
  editable,
  onEdit,
}: {
  children: ReactNode;
  editable: boolean;
  onEdit: () => void;
}) {
  return (
    <div
      className="flex min-h-0 flex-1"
      onDoubleClickCapture={() => {
        if (editable) onEdit();
      }}
    >
      {children}
    </div>
  );
}
