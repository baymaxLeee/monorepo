import { Button } from "@repo/design-system";
import { useAtom, useAtomValue } from "jotai";
import { ArrowLeft, MessageSquare, PanelsTopLeft, Film, PanelLeftClose, PanelLeftOpen, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";

import { canvasGraphAtom } from "../store/graph";
import { studioViewAtom, nodePanelOpenAtom, chatPanelOpenAtom } from "../store/studio";
import { CanvasArchives } from "./CanvasArchives";
import { GenerateAll } from "./GenerateAll";

export function StudioToolbar({
  projectId,
  canvasId,
  busy,
  beforeStart,
  onRefresh,
  onViewChange,
}: {
  projectId: string;
  canvasId: string;
  busy: boolean;
  beforeStart: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onViewChange: (view: "canvas" | "storyboard") => Promise<void>;
}) {
  const graph = useAtomValue(canvasGraphAtom);
  const view = useAtomValue(studioViewAtom);
  const [leftOpen, setLeftOpen] = useAtom(nodePanelOpenAtom);
  const [chatOpen, setChatOpen] = useAtom(chatPanelOpenAtom);
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
      <Button asChild size="icon" variant="ghost">
        <Link to={`/platform/canvas/projects/${projectId}`} aria-label="返回项目">
          <ArrowLeft />
        </Link>
      </Button>
      <h1 className="flex-1 truncate font-medium">{graph?.canvas.name ?? "画布"}</h1>
      <Button
        size="icon"
        variant="ghost"
        onClick={() => setLeftOpen(!leftOpen)}
        aria-label={leftOpen ? "收起节点面板" : "展开节点面板"}
      >
        {leftOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
      </Button>
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        <Button
          size="sm"
          variant={view === "canvas" ? "secondary" : "ghost"}
          onClick={() => void onViewChange("canvas")}
        >
          <PanelsTopLeft className="size-4" />
          画布
        </Button>
        <Button
          size="sm"
          variant={view === "storyboard" ? "secondary" : "ghost"}
          onClick={() => void onViewChange("storyboard")}
        >
          <Film className="size-4" />
          故事板
        </Button>
      </div>
      <Button size="icon" variant="ghost" onClick={() => void onRefresh()} aria-label="刷新">
        <RefreshCw className="size-4" />
      </Button>
      <Button
        size="icon"
        variant={chatOpen ? "secondary" : "ghost"}
        onClick={() => setChatOpen(!chatOpen)}
        aria-label="对话"
      >
        <MessageSquare className="size-4" />
      </Button>
      <CanvasArchives
        canvasId={canvasId}
        beforeStart={beforeStart}
        disabled={busy || !graph?.nodes.some((node) => node.type === 6 && node.asset_id)}
      />
      <GenerateAll
        canvasId={canvasId}
        disabled={busy || !graph?.nodes.some((node) => node.type === 6)}
        beforeStart={beforeStart}
        onStarted={onRefresh}
      />
    </header>
  );
}
