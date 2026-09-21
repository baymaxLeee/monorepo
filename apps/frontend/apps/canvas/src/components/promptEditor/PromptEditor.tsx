import { MarkdownEditor, type MarkdownEditorRef } from "@repo/editors/markdown-editor";
import type { AnyExtension } from "@tiptap/core";
import { forwardRef, useEffect, useRef } from "react";

import styles from "./PromptEditor.module.less";

const TOP_FADE = 48;
const BOTTOM_FADE = 72;

/** 两端渐隐，只给确实还有内容被裁掉的那一侧加，另一侧保持全不透明。 */
function buildMask(top: boolean, bottom: boolean) {
  const head = top ? `rgba(0,0,0,0) 0, rgba(0,0,0,0.55) ${TOP_FADE / 2}px, #000 ${TOP_FADE}px` : "#000 0";
  const tail = bottom
    ? `#000 calc(100% - ${BOTTOM_FADE}px), rgba(0,0,0,0.55) calc(100% - ${BOTTOM_FADE / 2}px), rgba(0,0,0,0) 100%`
    : "#000 100%";
  return `linear-gradient(to bottom, ${head}, ${tail})`;
}

export const PromptEditor = forwardRef<
  MarkdownEditorRef,
  {
    editable: boolean;
    extensions?: AnyExtension[];
    /** 只读且降透明度；光标落到 not-allowed 与设计稿一致。 */
    locked?: boolean;
    placeholder?: string | null;
    value: string;
    onChange: (value: string) => void;
  }
>(function PromptEditor({ editable, extensions, locked = false, placeholder, value, onChange }, ref) {
  const rootRef = useRef<HTMLDivElement>(null);

  /**
   * 编辑器自带滚动容器（.ProseMirror 的父节点），渐隐必须挂在它身上，
   * 挂在外层不滚动的包裹层上只会得到硬截断。
   */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    const syncFade = () => {
      const node = root.querySelector<HTMLElement>(".ProseMirror")?.parentElement;
      if (node) {
        const top = node.scrollTop > 1;
        const bottom = node.scrollHeight - node.scrollTop - node.clientHeight > 1;
        const mask = top || bottom ? buildMask(top, bottom) : "";
        node.style.maskImage = mask;
        node.style.webkitMaskImage = mask;
      }
    };

    // 编辑器挂载和正文变化都通过 DOM 变更感知，避免依赖它的内部渲染时序。
    const observer = new MutationObserver(syncFade);
    observer.observe(root, {
      characterData: true,
      childList: true,
      subtree: true,
    });
    root.addEventListener("scroll", syncFade, true);
    window.addEventListener("resize", syncFade);
    syncFade();

    return () => {
      observer.disconnect();
      root.removeEventListener("scroll", syncFade, true);
      window.removeEventListener("resize", syncFade);
    };
  }, []);

  const writable = editable && !locked;

  return (
    <section className="relative flex min-h-0 flex-1 flex-col">
      <div
        className={`min-h-0 flex-1 text-[14px] leading-6.5 text-foreground ${
          locked ? "cursor-not-allowed opacity-60" : ""
        }`}
        ref={rootRef}
      >
        <MarkdownEditor
          contentType="markdown"
          editable={writable}
          extensions={extensions}
          features={{
            blockDrag: false,
            blockMenu: false,
            codeBlock: false,
          }}
          onChange={onChange}
          placeholder={placeholder ?? undefined}
          className={styles.editor}
          ref={ref}
          value={value}
        />
      </div>
    </section>
  );
});
