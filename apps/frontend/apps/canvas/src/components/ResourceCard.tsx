import type { CanvasResource } from "@repo/api";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/design-system";
import { Box, MoreHorizontal, Music2, Sparkles } from "lucide-react";

import { ResourceMedia } from "./ResourceMedia";

export function ResourceCard({
  projectId,
  resource,
  onManage,
  onEdit,
  onDelete,
}: {
  projectId: string;
  resource: CanvasResource;
  onManage: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isAudio = resource.type === 4;
  return (
    <article className="group relative overflow-hidden rounded-2xl border border-transparent p-[3px] transition-colors hover:border-border">
      <button className="flex w-full flex-col gap-3 bg-transparent p-0 pb-4 text-left" onClick={onManage} type="button">
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-muted">
          {resource.primary_resource_asset_id ? (
            <ResourceMedia
              projectId={projectId}
              assetId={resource.primary_resource_asset_id}
              name={resource.name}
              type={isAudio ? 3 : 1}
              compact
              className="transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              {isAudio ? <Music2 className="size-10" /> : <Sparkles className="size-10" />}
            </div>
          )}
        </div>
        <div className="space-y-2 px-3">
          <h2 className="truncate text-base font-medium group-hover:text-primary">{resource.name}</h2>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1 font-normal">
              <Box className="size-3" />
              {resource.resource_asset_count}
            </Badge>
            {resource.description ? (
              <span className="truncate text-xs text-muted-foreground">{resource.description}</span>
            ) : null}
          </div>
        </div>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="secondary"
            className="absolute right-3 top-3 size-8 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus:opacity-100"
            aria-label={`管理${resource.name}`}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onManage}>管理素材</DropdownMenuItem>
          <DropdownMenuItem onSelect={onEdit}>编辑资产</DropdownMenuItem>
          <DropdownMenuItem className="text-destructive" onSelect={onDelete}>
            删除资产
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </article>
  );
}
