import { useChatStore } from "@repo/ai-elements/conversation/store/useChatStore";
import { lazy, Suspense, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const Memory = lazy(() => import("./ChatMemorySheet").then((m) => ({ default: m.ChatMemorySheet })));
const Trace = lazy(() => import("./ChatTraceSheet").then((m) => ({ default: m.ChatTraceSheet })));

export function ChatAuxiliaryPanels() {
  const memoryOpen = useChatStore((s) => s.memoryPanelOpen);
  const traceOpen = useChatStore((s) => s.tracePanelOpen);
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get("panel") !== "memory") return;
    useChatStore.getState().setMemoryPanelOpen(true);
    params.delete("panel");
    navigate({ pathname, search: params.toString() }, { replace: true });
  }, [pathname, search, navigate]);
  return (
    <Suspense fallback={null}>
      {memoryOpen ? <Memory /> : null}
      {traceOpen ? <Trace /> : null}
    </Suspense>
  );
}
