import { canvasCancelGeneration } from "@repo/api";
import { Button } from "@repo/design-system";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useAtomValue } from "jotai";
import { FileText, Image, Video, Sparkles, LoaderCircle } from "lucide-react";
import { useMemo } from "react";

import { nodeGenerationAtom } from "../store/generations";
import { canvasGraphAtom, nodeAtom } from "../store/graph";
import { MediaPreview } from "./MediaPreview";

export type FlowNode = Node<{ nodeId: string }, "canvas">;
export function CanvasNode({ data, selected }: NodeProps<FlowNode>) {
  const selectedNodeAtom = useMemo(() => nodeAtom(data.nodeId), [data.nodeId]);
  const node = useAtomValue(selectedNodeAtom);
  const selectedGenerationAtom = useMemo(() => nodeGenerationAtom(data.nodeId), [data.nodeId]);
  const generation = useAtomValue(selectedGenerationAtom);
  const generating = generation?.status === "queued" || generation?.status === "running";
  const graph = useAtomValue(canvasGraphAtom);
  if (!node) return null;
  const Icon = node.type === 5 ? Image : node.type === 6 ? Video : node.type === 7 ? Sparkles : FileText;
  return (
    <div className={`w-64 rounded-xl border bg-card shadow-sm ${selected ? "ring-2 ring-primary" : ""}`}>
      {node.type >= 5 ? <Handle type="target" position={Position.Left} /> : null}
      <div className="flex items-center gap-2 border-b px-3 py-2 text-sm font-medium">
        <Icon className="size-4 text-muted-foreground" />
        {node.name}
      </div>
      {node.asset_id && graph ? (
        <MediaPreview
          key={node.asset_id}
          canvasId={graph.canvas.id}
          nodeId={node.id}
          type={node.type}
          name={node.name}
        />
      ) : (
        <div className="max-h-48 min-h-24 overflow-hidden whitespace-pre-wrap p-3 text-sm text-muted-foreground">
          {node.text || node.prompt || "选择节点以编辑内容"}
        </div>
      )}
      {generating && graph ? (
        <div className="flex items-center justify-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
          <LoaderCircle className="size-3 animate-spin" />
          {generation.status === "queued" ? "排队中" : "生成中"}
          <Button
            className="nodrag nopan h-6 px-2 text-xs"
            size="sm"
            variant="ghost"
            disabled={generation.cancel_requested}
            onClick={(event) => {
              event.stopPropagation();
              void canvasCancelGeneration(graph.canvas.id, generation.id).catch(() => {});
            }}
          >
            {generation.cancel_requested ? "停止中" : "停止"}
          </Button>
        </div>
      ) : generation?.status === "failed" ? (
        <p className="px-3 py-2 text-xs text-destructive">生成失败，选择节点查看详情</p>
      ) : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
