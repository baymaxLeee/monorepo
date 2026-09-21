import type { CanvasNode } from "@repo/api";
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@repo/design-system";
import { useAtomValue } from "jotai";
import { ArrowLeftRight } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";

import { canvasGraphAtom } from "../../store/graph";

export function FrameReferences({ form, disabled }: { form: UseFormReturn<CanvasNode>; disabled: boolean }) {
  const graph = useAtomValue(canvasGraphAtom);
  const edges = form.watch("incoming_edges");
  const images =
    graph?.nodes.filter((node) => node.id !== form.getValues("id") && [1, 5].includes(node.type) && node.asset_id) ??
    [];
  const first = edges.find((edge) => edge.target_port === "FIRST_FRAME");
  const last = edges.find((edge) => edge.target_port === "LAST_FRAME");
  return (
    <div className="flex items-center gap-2">
      {(["FIRST_FRAME", "LAST_FRAME"] as const).map((port) => (
        <Select
          key={port}
          disabled={disabled}
          value={edges.find((edge) => edge.target_port === port)?.source_node_id ?? "none"}
          onValueChange={(id) => {
            const next = edges.filter((edge) => edge.target_port !== port);
            if (id !== "none")
              next.push({
                id: crypto.randomUUID(),
                source_node_id: id,
                source_port: "OUTPUT",
                target_port: port,
                target_order: 0,
              });
            form.setValue("incoming_edges", next, { shouldDirty: true });
          }}
        >
          <SelectTrigger className="min-w-0 flex-1" aria-label={port === "FIRST_FRAME" ? "首帧图片" : "尾帧图片"}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{port === "FIRST_FRAME" ? "选择首帧" : "选择尾帧（可选）"}</SelectItem>
            {images.map((node) => (
              <SelectItem key={node.id} value={node.id}>
                {node.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={disabled || !first || !last}
        aria-label="交换首尾帧"
        onClick={() =>
          form.setValue(
            "incoming_edges",
            edges.map((edge) =>
              edge.target_port === "FIRST_FRAME"
                ? { ...edge, target_port: "LAST_FRAME" }
                : edge.target_port === "LAST_FRAME"
                  ? { ...edge, target_port: "FIRST_FRAME" }
                  : edge,
            ),
            { shouldDirty: true },
          )
        }
      >
        <ArrowLeftRight className="size-4" />
      </Button>
    </div>
  );
}
