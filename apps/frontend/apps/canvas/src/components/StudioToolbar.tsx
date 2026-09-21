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
    <header
      className={`pointer-events-none absolute inset-x-0 top-0 z-30 flex h-12 items-center justify-between pr-5 ${view === "storyboard" ? "border-b bg-white" : ""}`}
    >
      <div className="flex min-w-0 items-center gap-4">
        <div
          className={`pointer-events-auto flex h-12 min-w-0 items-center gap-4 px-5 ${leftOpen ? "w-[300px] shrink-0 border-b border-r bg-white" : ""}`}
        >
          <Button asChild size="icon" variant="outline" className="size-6 rounded-lg bg-white p-0 shadow-none">
            <Link to={`/platform/canvas/projects/${projectId}`} aria-label="返回项目">
              <ArrowLeft />
            </Link>
          </Button>
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{graph?.canvas.name ?? "画布"}</h1>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="pointer-events-auto size-7"
          onClick={() => setLeftOpen(!leftOpen)}
          aria-label={leftOpen ? "收起节点面板" : "展开节点面板"}
        >
          {leftOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
        </Button>
        <div className="pointer-events-auto flex h-8 items-center gap-1 rounded-lg bg-[#f6f6f6]/70 px-1 backdrop-blur-md">
          <Button
            size="sm"
            variant={view === "canvas" ? "secondary" : "ghost"}
            className={view === "canvas" ? "h-6 gap-1 rounded-md bg-white px-2 text-xs shadow-sm" : "size-6 p-0"}
            aria-label="切换到画布"
            onClick={() => void onViewChange("canvas")}
          >
            <PanelsTopLeft className="size-4" />
            {view === "canvas" ? "画布" : null}
          </Button>
          <Button
            size="sm"
            variant={view === "storyboard" ? "secondary" : "ghost"}
            className={view === "storyboard" ? "h-6 gap-1 rounded-md bg-white px-2 text-xs shadow-sm" : "size-6 p-0"}
            aria-label="切换到故事板"
            onClick={() => void onViewChange("storyboard")}
          >
            <Film className="size-4" />
            {view === "storyboard" ? "故事板" : null}
          </Button>
        </div>
      </div>
      <div className="pointer-events-auto flex shrink-0 items-center gap-3">
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
      </div>
    </header>
  );
}
