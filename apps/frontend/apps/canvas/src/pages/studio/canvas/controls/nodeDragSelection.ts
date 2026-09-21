type SelectableNode = {
  id: string;
  selected?: boolean;
};

export function selectNodesForDrag<T extends SelectableNode>(nodes: T[], draggedNodeId: string): T[] {
  if (nodes.some((node) => node.id === draggedNodeId && node.selected)) {
    return nodes;
  }
  return nodes.map((node) => {
    const selected = node.id === draggedNodeId;
    return Boolean(node.selected) === selected ? node : { ...node, selected };
  });
}
