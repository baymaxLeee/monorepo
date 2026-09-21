import type { CanvasResource } from "@repo/api";
import { Button } from "@repo/design-system";
import { Pencil, Trash2 } from "lucide-react";

export function CompactResources({
  items,
  onManage,
  onEdit,
  onDelete,
}: {
  items: CanvasResource[];
  onManage: (item: CanvasResource) => void;
  onEdit: (item: CanvasResource) => void;
  onDelete: (item: CanvasResource) => void;
}) {
  return (
    <div className="space-y-1 p-2">
      {items.map((resource) => (
        <div key={resource.id} className="group flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-muted">
          <Button className="min-w-0 flex-1 justify-start" variant="ghost" onClick={() => onManage(resource)}>
            <span className="truncate">{resource.name}</span>
            <span className="text-muted-foreground">· {resource.resource_asset_count}</span>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8 opacity-0 group-hover:opacity-100"
            onClick={() => onEdit(resource)}
            aria-label={`编辑${resource.name}`}
          >
            <Pencil className="size-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8 opacity-0 group-hover:opacity-100"
            onClick={() => onDelete(resource)}
            aria-label={`删除${resource.name}`}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}
