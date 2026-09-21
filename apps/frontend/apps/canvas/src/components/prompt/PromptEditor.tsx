import type { CanvasNode } from "@repo/api";
import { type MarkdownEditorRef } from "@repo/editors/markdown-editor";
import { useStore } from "jotai";
import { forwardRef, useMemo, useRef } from "react";

import { useCreativeAssets } from "../../hooks/useCreativeAssets";
import { canvasGraphAtom } from "../../store/graph";
import { createAssetMentionExtension } from "./assetMention";
import { BasePromptEditor } from "./BasePromptEditor";

import "./prompt-editor.css";

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
  return (
    <BasePromptEditor
      ref={ref}
      value={value}
      onChange={onChange}
      editable={editable}
      locked={locked}
      extensions={extensions}
      placeholder="输入分镜脚本提示词"
    />
  );
});
