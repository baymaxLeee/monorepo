type PositionedCanvasNode = {
  id: string;
  position: {
    x: number;
    y: number;
  };
};

export function canvasNodePositionUpdates(primaryNode: PositionedCanvasNode, draggedNodes: PositionedCanvasNode[]) {
  const movedNodes = new Map(draggedNodes.map((node) => [node.id, node] as const));
  movedNodes.set(primaryNode.id, primaryNode);

  return [...movedNodes.values()].map((node) => ({
    NodeID: node.id,
    Position: {
      PositionX: node.position.x,
      PositionY: node.position.y,
    },
  }));
}
