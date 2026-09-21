import { canvasCancelGeneration } from "@repo/api";
import { Button } from "@repo/design-system";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useAtomValue } from "jotai";
import { Music, LoaderCircle } from "lucide-react";
import { useMemo } from "react";

import imageIcon from "../assets/canvas/menu-image-generation.svg";
import textIcon from "../assets/canvas/menu-text-generation.svg";
import videoIcon from "../assets/canvas/menu-video-generation.svg";
import { nodeGenerationAtom } from "../store/generations";
import { canvasGraphAtom, nodeAtom } from "../store/graph";
import { MediaPreview } from "./MediaPreview";

import styles from "./CanvasBoard.module.less";

export type FlowNode = Node<{ nodeId: string }, "canvas">;
export function CanvasNode({ data, selected }: NodeProps<FlowNode>) {
  const selectedNodeAtom = useMemo(() => nodeAtom(data.nodeId), [data.nodeId]);
  const node = useAtomValue(selectedNodeAtom);
  const selectedGenerationAtom = useMemo(() => nodeGenerationAtom(data.nodeId), [data.nodeId]);
  const generation = useAtomValue(selectedGenerationAtom);
  const generating = generation?.status === "queued" || generation?.status === "running";
  const graph = useAtomValue(canvasGraphAtom);
  if (!node) return null;
  const icon = [1, 5].includes(node.type) ? imageIcon : [2, 6].includes(node.type) ? videoIcon : textIcon;
  return (
    <div className={`${styles.node} ${styles.contentNode} ${selected ? "selected" : ""}`}>
      {node.type >= 5 ? <Handle className={styles.handle} type="target" position={Position.Left} /> : null}
      <div className={`${styles.nodeHeader} canvas-node-drag-handle`}>
        <div className={styles.nodeHeaderContent}>
          <img alt="" src={icon} className={styles.nodeKind} />
          <span className={styles.nodeTitle}>{node.name}</span>
        </div>
      </div>
      <div className={styles.previewShell}>
        {node.asset_id && graph ? (
          <MediaPreview
            key={node.asset_id}
            canvasId={graph.canvas.id}
            nodeId={node.id}
            type={node.type}
            name={node.name}
          />
        ) : (
          <div className={node.text ? styles.textPreview : styles.placeholder}>
            {node.text ||
              (node.type === 3 ? <Music className="size-16 text-muted-foreground" /> : <img alt="" src={icon} />)}
          </div>
        )}
      </div>
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
      <Handle className={styles.handle} type="source" position={Position.Right} />
    </div>
  );
}
