import { Button, ScrollArea } from "@repo/design-system";
import { useAtomValue } from "jotai";
import { ArrowLeft, ArrowRight, Film, Plus } from "lucide-react";

import { storyboardNodesAtom } from "../store/graph";

export function Storyboard({
  selectedId,
  busy,
  onSelect,
  onAdd,
  onMove,
}: {
  selectedId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onMove: (id: string, direction: -1 | 1) => void;
}) {
  const shots = useAtomValue(storyboardNodesAtom);
  const shot = shots.find((node) => node.id === selectedId);
  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/20">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-8">
        <Film className="size-12 text-muted-foreground" />
        <h2 className="text-lg font-medium">{shot?.name ?? (shots.length ? "选择分镜" : "开始创作故事板")}</h2>
        <p className="max-w-xl whitespace-pre-wrap text-sm text-muted-foreground">
          {shot?.prompt || (shots.length ? "选择下方分镜编辑脚本" : "添加分镜，编写脚本并安排镜头顺序")}
        </p>
        {!shots.length ? (
          <Button disabled={busy} onClick={onAdd}>
            <Plus className="size-4" />
            添加分镜
          </Button>
        ) : null}
      </div>
      <ScrollArea className="shrink-0 border-t bg-background">
        <div className="flex gap-3 overflow-x-auto p-4">
          {shots.map((item, index) => (
            <div
              key={item.id}
              className={`w-40 shrink-0 rounded-lg border ${item.id === selectedId ? "ring-2 ring-primary" : ""}`}
            >
              <button type="button" className="w-full text-left" onClick={() => onSelect(item.id)}>
                <div className="flex aspect-video items-center justify-center rounded-t-lg bg-muted">
                  <Film className="size-6 text-muted-foreground" />
                </div>
                <p className="truncate px-2 pt-2 text-sm">
                  {index + 1}. {item.name}
                </p>
              </button>
              <div className="flex justify-between p-1">
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={busy || index === 0}
                  aria-label="前移分镜"
                  onClick={() => onMove(item.id, -1)}
                >
                  <ArrowLeft className="size-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={busy || index === shots.length - 1}
                  aria-label="后移分镜"
                  onClick={() => onMove(item.id, 1)}
                >
                  <ArrowRight className="size-3" />
                </Button>
              </div>
            </div>
          ))}
          <Button variant="outline" className="h-32 w-32 shrink-0" disabled={busy} onClick={onAdd}>
            <Plus className="size-5" />
            添加分镜
          </Button>
        </div>
      </ScrollArea>
    </div>
  );
}
