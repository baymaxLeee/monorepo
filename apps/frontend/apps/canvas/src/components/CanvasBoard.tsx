import {
  Background,
  Controls,
  ReactFlow,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";

import type { useCanvasGraph } from "../hooks/useCanvasGraph";
import { canvasGraphAtom } from "../store/graph";
import { CanvasNode, type FlowNode } from "./CanvasNode";
import type { CanvasSelection } from "./DeleteSelectionDialog";

const nodeTypes = { canvas: CanvasNode };
export function CanvasBoard({
  busy,
  mutate,
  onSelect,
  onDeleteSelection,
}: {
  busy: boolean;
  mutate: ReturnType<typeof useCanvasGraph>["mutate"];
  onSelect: (id: string | null) => void;
  onDeleteSelection: (selection: CanvasSelection) => void;
}) {
  const graph = useAtomValue(canvasGraphAtom);
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!graph) return;
    setNodes((previous) => {
      const selection = new Set(previous.filter((node) => node.selected).map((node) => node.id));
      return graph.nodes.map((node) => ({
        id: node.id,
        type: "canvas",
        position: { x: node.x, y: node.y },
        data: { nodeId: node.id },
        selected: selection.has(node.id),
      }));
    });
  }, [graph]);
  const edges =
    graph?.nodes.flatMap((node) =>
      node.incoming_edges.map((edge) => ({
        id: edge.id,
        source: edge.source_node_id,
        target: node.id,
        selected: selectedEdges.has(edge.id),
      })),
    ) ?? [];
  function connect(connection: Connection) {
    void mutate((current) => {
      const source = current.nodes.find((node) => node.id === connection.source);
      const target = current.nodes.find((node) => node.id === connection.target);
      if (!source || !target) throw new Error("连接节点已不存在");
      const port =
        source.type === 1 || source.type === 5
          ? "REFERENCE_IMAGE"
          : source.type === 2 || source.type === 6
            ? "REFERENCE_VIDEO"
            : source.type === 3
              ? "REFERENCE_AUDIO"
              : "REFERENCE_TEXT";
      return [
        {
          ...target,
          incoming_edges: [
            ...target.incoming_edges,
            {
              id: crypto.randomUUID(),
              source_node_id: source.id,
              source_port: "OUTPUT",
              target_port: port,
              target_order:
                Math.max(
                  -1,
                  ...target.incoming_edges.filter((edge) => edge.target_port === port).map((edge) => edge.target_order),
                ) + 1,
            },
          ],
        },
      ];
    }).catch(() => {});
  }
  return (
    <ReactFlow<FlowNode>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={(changes: NodeChange<FlowNode>[]) => setNodes((current) => applyNodeChanges(changes, current))}
      onNodeClick={(event, node) => {
        if (!event.metaKey && !event.ctrlKey) onSelect(node.id);
      }}
      onPaneClick={() => onSelect(null)}
      onConnect={connect}
      nodesDraggable={!busy}
      nodesConnectable={!busy}
      deleteKeyCode={["Backspace", "Delete"]}
      nodesFocusable={false}
      edgesFocusable={false}
      multiSelectionKeyCode={["Meta", "Control"]}
      onEdgeClick={(event) => {
        if (!event.metaKey && !event.ctrlKey) onSelect(null);
      }}
      onEdgesChange={(changes: EdgeChange[]) =>
        setSelectedEdges((current) => {
          const next = new Set(current);
          for (const change of changes)
            if (change.type === "select") {
              if (change.selected) next.add(change.id);
              else next.delete(change.id);
            }
          return next;
        })
      }
      onBeforeDelete={async ({ nodes: deletingNodes, edges: deletingEdges }) => {
        if (!busy)
          onDeleteSelection({
            nodes: deletingNodes.map((node) => node.id),
            edges: deletingEdges.map((edge) => edge.id),
          });
        return false;
      }}
      onNodeDragStop={(_, node, dragged) => {
        const positions = new Map([...dragged, node].map((value) => [value.id, value.position]));
        void mutate((current) =>
          current.nodes
            .filter((value) => positions.has(value.id))
            .map((value) => ({ ...value, ...positions.get(value.id)! })),
        ).catch(() => {});
      }}
      fitView
    >
      <Background />
      <Controls />
    </ReactFlow>
  );
}
