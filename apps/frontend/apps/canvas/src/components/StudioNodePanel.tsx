import { Button, Input, ScrollArea } from "@repo/design-system";
import { useAtomValue } from "jotai";
import { FileText, Image, Search, Sparkles, Video } from "lucide-react";
import { useState } from "react";

import { canvasNodesAtom } from "../store/graph";
import { UploadMedia } from "./UploadMedia";

export const nodeKinds = [
  { type: 4, name: "文本", icon: FileText },
  { type: 7, name: "文本生成", icon: Sparkles },
  { type: 5, name: "图片生成", icon: Image },
  { type: 6, name: "视频生成", icon: Video },
] as const;

export function StudioNodePanel({
  busy,
  selectedId,
  onCreate,
  onSelect,
}: {
  busy: boolean;
  selectedId: string | null;
  onCreate: (type: number) => void;
  onSelect: (id: string) => void;
}) {
  const nodes = useAtomValue(canvasNodesAtom);
  const [query, setQuery] = useState("");
  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r bg-background" aria-label="节点面板">
      <div className="space-y-4 border-b p-4">
        <h2 className="text-sm font-medium">节点</h2>
        <UploadMedia />
        <div className="grid grid-cols-2 gap-2">
          {nodeKinds.map(({ type, name, icon: Icon }) => (
            <Button
              key={type}
              disabled={busy}
              variant="outline"
              className="justify-start"
              onClick={() => onCreate(type)}
            >
              <Icon className="size-4" />
              {name}
            </Button>
          ))}
        </div>
      </div>
      <div className="relative m-4">
        <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
        <Input
          aria-label="搜索节点"
          placeholder="输入名称搜索"
          className="pl-9"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-1 px-3 pb-4">
          {nodes
            .filter((node) => node.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
            .map((node) => {
              const Icon = nodeKinds.find((kind) => kind.type === node.type)?.icon ?? FileText;
              return (
                <Button
                  key={node.id}
                  variant={selectedId === node.id ? "secondary" : "ghost"}
                  className="w-full justify-start"
                  onClick={() => onSelect(node.id)}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="truncate">{node.name}</span>
                </Button>
              );
            })}
        </div>
      </ScrollArea>
    </aside>
  );
}
