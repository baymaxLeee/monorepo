import { canvasCreativeProviders, type CanvasGraph } from "@repo/api";
import type { RefObject } from "react";

import type { NodeEditorHandle } from "../components/NodeEditor";
import { nodeKinds } from "../components/StudioNodePanel";
import type { useCanvasGraph } from "./useCanvasGraph";

export function useStudioNodeActions(
  projectId: string,
  graph: CanvasGraph | null,
  mutate: ReturnType<typeof useCanvasGraph>["mutate"],
  editor: RefObject<NodeEditorHandle>,
  setSelected: (id: string | null) => void,
) {
  async function createNode(type: number, insertion?: number) {
    if (!graph) return;
    try {
      await editor.current?.finish();
      const kind = type === 5 ? "image" : type === 6 ? "video" : "chat";
      const available =
        type >= 5 ? (await canvasCreativeProviders(projectId)).items.filter((item) => item.provider_kind === kind) : [];
      const providerId = available.find((item) => item.is_default)?.id ?? available[0]?.id ?? "";
      const id = crypto.randomUUID();
      await mutate((current) => {
        const ordered = current.nodes
          .filter((node) => node.type === 6)
          .sort((a, b) => a.storyboard_rank - b.storyboard_rank || a.id.localeCompare(b.id));
        const at = insertion === undefined ? ordered.length : Math.min(Math.max(0, insertion), ordered.length);
        return [
          {
            id,
            asset_id: "",
            type,
            name: nodeKinds.find((kind) => kind.type === type)?.name ?? "节点",
            text: "",
            prompt: "",
            x: graph.nodes.length * 40,
            y: graph.nodes.length * 40,
            storyboard_rank: type === 6 ? (at + 1) * 1024 : 0,
            revision: 0,
            video_input_mode: 1,
            generation_config: {
              provider_id: providerId,
              resolution: "",
              aspect_ratio: "",
              duration_seconds: 0,
              generate_audio: false,
              watermark: false,
            },
            incoming_edges: [],
          },
          ...(type === 6
            ? ordered.map((node, index) => ({ ...node, storyboard_rank: (index >= at ? index + 2 : index + 1) * 1024 }))
            : []),
        ];
      });
      setSelected(id);
    } catch {
      /* API errors retain the previous state. */
    }
  }
  async function reorderShots(ids: string[]) {
    try {
      await editor.current?.finish();
      await mutate((current) => {
        const shots = current.nodes.filter((node) => node.type === 6);
        if (
          shots.length !== ids.length ||
          new Set(ids).size !== ids.length ||
          shots.some((node) => !ids.includes(node.id))
        ) {
          throw new Error("分镜列表已更新，请重试排序");
        }
        return ids.map((id, index) => ({
          ...shots.find((node) => node.id === id)!,
          storyboard_rank: (index + 1) * 1024,
        }));
      });
    } catch {
      /* Keep the authoritative order after a conflict. */
    }
  }
  return { createNode, reorderShots };
}
