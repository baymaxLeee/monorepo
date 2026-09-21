import { Popover, PopoverContent, PopoverTrigger, Button } from "@repo/design-system";
import { useReactFlow, type Edge } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";

import type { useCanvasGraph } from "../hooks/useCanvasGraph";
import type { CanvasFlowNode } from "../pages/studio/canvas/graph/canvasNodeTypes";
import { layoutCanvasNodes } from "../pages/studio/canvas/graph/layout";
import { CanvasBoardControls } from "./CanvasBoardControls";
import { nodeKinds } from "./StudioNodePanel";
import { UploadMedia } from "./UploadMedia";

export function CanvasTools({
  busy,
  mutate,
  mode,
  setMode,
  onCreate,
  addOpen,
  setAddOpen,
}: {
  busy: boolean;
  mutate: ReturnType<typeof useCanvasGraph>["mutate"];
  mode: "select" | "hand";
  setMode: (mode: "select" | "hand") => void;
  onCreate: (type: number) => void;
  addOpen: boolean;
  setAddOpen: (open: boolean) => void;
}) {
  const flow = useReactFlow<CanvasFlowNode, Edge>();
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const arranging = useRef(false);
  async function arrange() {
    if (busy || arranging.current) return false;
    const positions = layoutCanvasNodes(flow.getNodes(), flow.getEdges());
    if (!positions) return false;
    arranging.current = true;
    try {
      await mutate((graph) =>
        graph.nodes.filter((node) => positions.has(node.id)).map((node) => ({ ...node, ...positions.get(node.id)! })),
      );
      requestAnimationFrame(() => {
        void flow.fitView({ duration: 240 });
      });
      return true;
    } catch {
      return false;
    } finally {
      arranging.current = false;
    }
  }
  const actions = useRef({ arrange, mode, setMode });
  actions.current = { arrange, mode, setMode };
  useEffect(() => {
    let previous: "select" | "hand" | undefined;
    const down = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('input, textarea, [contenteditable="true"], [role="dialog"]')
      )
        return;
      if (event.code === "Space" && !event.repeat) {
        event.preventDefault();
        previous = actions.current.mode;
        actions.current.setMode("hand");
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.code === "KeyV") actions.current.setMode("select");
        if (event.code === "KeyH") actions.current.setMode("hand");
      }
      if (event.altKey && event.shiftKey && event.code === "KeyF") {
        event.preventDefault();
        void actions.current.arrange();
      }
      if (event.ctrlKey || event.metaKey) {
        if (["Equal", "NumpadAdd"].includes(event.code)) {
          event.preventDefault();
          void flow.zoomIn();
        }
        if (["Minus", "NumpadSubtract"].includes(event.code)) {
          event.preventDefault();
          void flow.zoomOut();
        }
        if (event.code === "Digit0") {
          event.preventDefault();
          void flow.fitView({ duration: 240 });
        }
      }
    };
    const up = () => {
      if (previous) {
        actions.current.setMode(previous);
        previous = undefined;
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code === "Space") up();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", up);
    };
  }, [flow]);
  return (
    <>
      <CanvasBoardControls
        assetsOpen={false}
        graphLoaded
        nodeCount={flow.getNodes().length}
        canArrange={!busy && flow.getNodes().length > 0}
        instance={flow}
        interactionMode={mode}
        modeMenuOpen={modeMenuOpen}
        shortcutsOpen={shortcutsOpen}
        setModeMenuOpen={setModeMenuOpen}
        setShortcutsOpen={setShortcutsOpen}
        onDismissAddMenu={() => setAddOpen(false)}
        arrangeNodes={arrange}
        activateInteractionMode={(value) => {
          setMode(value);
          setModeMenuOpen(false);
        }}
        openToolbarAddMenu={() => {
          setAddOpen(!addOpen);
          setModeMenuOpen(false);
          setShortcutsOpen(false);
        }}
      />
      <Popover open={addOpen} onOpenChange={setAddOpen}>
        <PopoverTrigger asChild>
          <span className="pointer-events-none absolute bottom-16 left-1/2 h-px w-px" />
        </PopoverTrigger>
        <PopoverContent side="top" className="w-64 rounded-xl p-2">
          <UploadMedia />
          <div className="mt-2 flex flex-col gap-1">
            {nodeKinds.map(({ type, name, icon: Icon }) => (
              <Button
                key={type}
                type="button"
                disabled={busy}
                variant="ghost"
                className="justify-start"
                onClick={() => {
                  setAddOpen(false);
                  onCreate(type);
                }}
              >
                <Icon className="size-4" />
                {name}
              </Button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
