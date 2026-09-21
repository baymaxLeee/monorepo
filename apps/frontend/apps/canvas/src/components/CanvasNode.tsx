import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useAtomValue } from "jotai";
import { FileText, Image, Video, Sparkles } from "lucide-react";
import { useMemo } from "react";

import { canvasGraphAtom, nodeAtom } from "../store/graph";
import { MediaPreview } from "./MediaPreview";

export type FlowNode = Node<{ nodeId: string }, "canvas">;
export function CanvasNode({ data, selected }: NodeProps<FlowNode>) {
  const selectedNodeAtom = useMemo(() => nodeAtom(data.nodeId), [data.nodeId]);
  const node = useAtomValue(selectedNodeAtom);
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
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
