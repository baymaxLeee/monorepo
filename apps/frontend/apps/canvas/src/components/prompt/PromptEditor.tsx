import type { CanvasNode } from "@repo/api";
import { MarkdownEditor, type MarkdownEditorRef } from "@repo/editors/markdown-editor";
import { useStore } from "jotai";
import { forwardRef, useEffect, useMemo, useRef } from "react";

import { useCreativeAssets } from "../../hooks/useCreativeAssets";
import { canvasGraphAtom } from "../../store/graph";
import { createAssetMentionExtension } from "./assetMention";

import "./prompt-editor.css";

const features = { blockDrag: false, blockMenu: false, codeBlock: false };
const buildMask = (top: boolean, bottom: boolean) =>
  `linear-gradient(to bottom, ${top ? "rgba(0,0,0,0) 0, rgba(0,0,0,0.55) 24px, #000 48px" : "#000 0"}, ${bottom ? "#000 calc(100% - 72px), rgba(0,0,0,0.55) calc(100% - 36px), rgba(0,0,0,0) 100%" : "#000 100%"})`;

// Ported from AgentFrame PromptEditor: preserve scroll fades and paragraph rhythm.
export const PromptEditor = forwardRef<
  MarkdownEditorRef,
  {
    value: string;
    onChange: (value: string) => void;
    editable: boolean;
    locked?: boolean;
    projectId: string;
    canvasId: string;
    nodeId: string;
    onReference: (node: CanvasNode) => void;
  }
>(function PromptEditor({ value, onChange, editable, locked = false, projectId, canvasId, nodeId, onReference }, ref) {
  const store = useStore();
  const { search, materialize } = useCreativeAssets(projectId, canvasId);
  const reference = useRef(onReference);
  reference.current = onReference;
  const extensions = useMemo(
    () => [
      createAssetMentionExtension(
        async (query) => {
          const graph = store.get(canvasGraphAtom);
          const target = graph?.nodes.find((node) => node.id === nodeId);
          if (!target || (target.type === 6 && target.video_input_mode === 2)) return [];
          const found = await search(query, (type) => {
            if (target.type === 7) return [4, 7].includes(type);
            if (target.type === 5) return [1, 4, 5, 7].includes(type);
            return [1, 2, 3, 4, 5, 6, 7].includes(type);
          });
          return found.filter((item) => {
            if (item.node?.id === nodeId) return false;
            if (!item.node) return true;
            return [4, 7].includes(item.node.type) ? Boolean(item.node.text) : Boolean(item.node.asset_id);
          });
        },
        async (item) => {
          const node = await materialize(item);
          if (node.id === nodeId) throw new Error("不能引用当前节点");
          reference.current(node);
          return node;
        },
      ),
    ],
    [materialize, search, store, nodeId],
  );
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const sync = () => {
      const scroller = element.querySelector<HTMLElement>(".ProseMirror")?.parentElement;
      if (!scroller) return;
      const top = scroller.scrollTop > 1;
      const bottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 1;
      scroller.style.maskImage = top || bottom ? buildMask(top, bottom) : "";
    };
    const observer = new MutationObserver(sync);
    observer.observe(element, { characterData: true, childList: true, subtree: true });
    element.addEventListener("scroll", sync, true);
    window.addEventListener("resize", sync);
    sync();
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", sync, true);
      window.removeEventListener("resize", sync);
    };
  }, []);
  return (
    <section className="relative flex min-h-0 flex-1 flex-col">
      {!value.trim() ? (
        <p className="pointer-events-none absolute left-0 top-[0.5em] z-10 m-0 text-sm leading-7 text-muted-foreground">
          输入分镜脚本提示词
        </p>
      ) : null}
      <div
        ref={root}
        className={`min-h-0 flex-1 text-sm leading-[26px] ${locked ? "cursor-not-allowed opacity-60" : ""}`}
      >
        <MarkdownEditor
          ref={ref}
          contentType="markdown"
          value={value}
          onChange={onChange}
          editable={editable && !locked}
          extensions={extensions}
          features={features}
          className="canvas-prompt-editor"
        />
      </div>
    </section>
  );
});
