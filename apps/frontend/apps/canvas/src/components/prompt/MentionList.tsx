import { cn } from "@repo/shared";
import { FileText, Image, Music, Video } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

import type { CreativeAssetItem } from "../../hooks/useCreativeAssets";

export interface MentionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}
export const MentionList = forwardRef<
  MentionListHandle,
  { items: CreativeAssetItem[]; command: (item: CreativeAssetItem) => void }
>(function MentionList({ items, command }, ref) {
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [items]);
  useImperativeHandle(ref, () => ({
    onKeyDown(event) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        setActive((value) =>
          items.length ? (value + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length : 0,
        );
        return true;
      }
      if (event.key === "Enter" && items[active]) {
        command(items[active]);
        return true;
      }
      return false;
    },
  }));
  return (
    <div
      className="max-h-80 w-[300px] overflow-y-auto rounded-xl border bg-popover p-2 text-popover-foreground shadow-lg"
      role="listbox"
      aria-label="引用画布素材"
    >
      <p className="px-2 py-2 text-xs text-muted-foreground">画布与项目素材</p>
      {items.length ? (
        items.map((item, index) => {
          const Icon = [1, 5].includes(item.type)
            ? Image
            : [2, 6].includes(item.type)
              ? Video
              : item.type === 3
                ? Music
                : FileText;
          return (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={index === active}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm",
                index === active && "bg-accent text-accent-foreground",
              )}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => command(item)}
            >
              <Icon className="size-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {item.source === "library" ? "资源库" : "画布"}
              </span>
            </button>
          );
        })
      ) : (
        <p className="px-3 py-5 text-center text-sm text-muted-foreground">未找到可引用素材</p>
      )}
    </div>
  );
});
