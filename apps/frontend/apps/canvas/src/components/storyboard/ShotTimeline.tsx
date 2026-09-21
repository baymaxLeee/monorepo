import type { CanvasNode } from "@repo/api";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/design-system";
import { cn } from "@repo/shared";
import { useAtomValue } from "jotai";
import { ChevronLeft, ChevronRight, Film, LoaderCircle, MoreHorizontal, Plus, Triangle } from "lucide-react";
import { useRef, useState } from "react";

import { useNodeMedia } from "../../hooks/useNodeMedia";
import { generationStatusAtom } from "../../store/generations";

function ShotThumbnail({ canvasId, shot }: { canvasId: string; shot: CanvasNode }) {
  const media = useNodeMedia(canvasId, shot.id, shot.asset_id);
  const status = useAtomValue(generationStatusAtom).get(shot.id)?.status;
  if (status === "running" || status === "queued") return <LoaderCircle className="size-5 animate-spin" />;
  if (media.url) return <video src={media.url} muted preload="metadata" className="size-full object-cover" />;
  return <Film className="size-6 text-muted-foreground" />;
}

export function ShotTimeline({
  canvasId,
  shots,
  selectedId,
  playingId,
  busy,
  onSelect,
  onAdd,
  onBatch,
  onRemove,
  onReorder,
}: {
  canvasId: string;
  shots: CanvasNode[];
  selectedId: string | null;
  playingId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onAdd: (index?: number) => void;
  onBatch: () => void;
  onRemove: (id: string) => void;
  onReorder: (ids: string[]) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const statuses = useAtomValue(generationStatusAtom);
  function reorder(source: string, target: string, after: boolean) {
    if (busy || source === target || !shots.some((shot) => shot.id === source)) return;
    const ids = shots.map((shot) => shot.id).filter((id) => id !== source);
    ids.splice(ids.indexOf(target) + (after ? 1 : 0), 0, source);
    onReorder(ids);
  }
  return (
    <footer
      className="mx-5 mb-5 flex shrink-0 items-center rounded-[20px] border bg-background"
      aria-label="分镜时间线"
    >
      <Button
        size="icon"
        variant="ghost"
        aria-label="向前浏览分镜"
        onClick={() => scroll.current?.scrollBy({ left: -300, behavior: "smooth" })}
      >
        <ChevronLeft className="size-4" />
      </Button>
      <div ref={scroll} className="min-w-0 flex-1 overflow-x-auto p-3" role="list" aria-label="分镜顺序">
        <div className="flex w-max items-start gap-3">
          {shots.map((shot, index) => {
            const state = statuses.get(shot.id);
            const active = state?.status === "queued" || state?.status === "running";
            return (
              <div key={shot.id} className="group relative flex shrink-0 gap-3" role="listitem">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      disabled={busy}
                      size="icon"
                      variant="ghost"
                      className="absolute -left-3 top-6 z-10 size-5 rounded-full border bg-background opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      aria-label={`在分镜 ${index + 1} 前插入`}
                      onClick={() => onAdd(index)}
                    >
                      <Plus className="size-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>在此处创建分镜</TooltipContent>
                </Tooltip>
                <div
                  draggable={!busy}
                  onDragStart={(event) => {
                    setDragging(shot.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", shot.id);
                  }}
                  onDragOver={(event) => {
                    if (!dragging || dragging === shot.id || busy) return;
                    event.preventDefault();
                    const box = event.currentTarget.getBoundingClientRect();
                    setDrop({ id: shot.id, after: event.clientX > box.left + box.width / 2 });
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setDrop(null);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragging && drop?.id === shot.id) reorder(dragging, shot.id, drop.after);
                    setDragging(null);
                    setDrop(null);
                  }}
                  className={cn(
                    "relative w-[138px]",
                    dragging === shot.id && "opacity-50",
                    drop?.id === shot.id && (drop.after ? "border-r-2 border-primary" : "border-l-2 border-primary"),
                  )}
                >
                  <button
                    type="button"
                    aria-pressed={selectedId === shot.id}
                    onClick={() => onSelect(shot.id)}
                    className={cn(
                      "block w-full rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selectedId === shot.id && "shadow-[0_0_0_6px_#bedaff]",
                    )}
                  >
                    <div className="relative flex h-[78px] items-center justify-center overflow-hidden rounded-xl bg-muted">
                      <ShotThumbnail canvasId={canvasId} shot={shot} />
                      {state?.status === "failed" ? (
                        <span className="absolute inset-x-0 bottom-0 bg-destructive/90 text-center text-xs text-destructive-foreground">
                          生成失败
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center justify-between gap-1 px-1 py-2 text-xs">
                      <span className="truncate">{shot.name || `分镜 ${index + 1}`}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {shot.generation_config.duration_seconds > 0
                          ? `${shot.generation_config.duration_seconds}s`
                          : "自动"}
                      </span>
                    </div>
                  </button>
                  {playingId === shot.id ? (
                    <Triangle
                      className="absolute -bottom-1 left-1/2 size-3 -translate-x-1/2 fill-primary text-primary"
                      aria-label="正在播放"
                    />
                  ) : null}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon"
                        variant="secondary"
                        className="absolute right-1 top-1 size-5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        aria-label={`分镜 ${index + 1} 更多操作`}
                      >
                        <MoreHorizontal className="size-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem
                        disabled={busy || index === 0}
                        onSelect={() => reorder(shot.id, shots[index - 1].id, false)}
                      >
                        向前移动
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={busy || index === shots.length - 1}
                        onSelect={() => reorder(shot.id, shots[index + 1].id, true)}
                      >
                        向后移动
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={busy || active}
                        className="text-destructive"
                        onSelect={() => onRemove(shot.id)}
                      >
                        删除分镜
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            );
          })}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                disabled={busy}
                className="h-[78px] w-[78px] shrink-0 rounded-xl border-dashed"
                aria-label="新增分镜"
              >
                <Plus className="size-6" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onAdd()}>单个分镜</DropdownMenuItem>
              <DropdownMenuItem onSelect={onBatch}>批量分镜</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <Button
        size="icon"
        variant="ghost"
        aria-label="向后浏览分镜"
        onClick={() => scroll.current?.scrollBy({ left: 300, behavior: "smooth" })}
      >
        <ChevronRight className="size-4" />
      </Button>
    </footer>
  );
}
