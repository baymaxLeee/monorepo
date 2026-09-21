import type { CanvasNode } from "@repo/api";
import type { UseFormReturn } from "react-hook-form";

export function addPromptReference(form: UseFormReturn<CanvasNode>, source: CanvasNode) {
  const edges = form.getValues("incoming_edges");
  const port = [1, 5].includes(source.type)
    ? "REFERENCE_IMAGE"
    : [2, 6].includes(source.type)
      ? "REFERENCE_VIDEO"
      : source.type === 3
        ? "REFERENCE_AUDIO"
        : "REFERENCE_TEXT";
  if (edges.some((edge) => edge.source_node_id === source.id && edge.target_port === port)) return;
  form.setValue(
    "incoming_edges",
    [
      ...edges,
      {
        id: crypto.randomUUID(),
        source_node_id: source.id,
        source_port: "OUTPUT",
        target_port: port,
        target_order:
          Math.max(-1, ...edges.filter((edge) => edge.target_port === port).map((edge) => edge.target_order)) + 1,
      },
    ],
    { shouldDirty: true },
  );
}
