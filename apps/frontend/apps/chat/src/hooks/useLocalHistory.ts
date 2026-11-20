import { downloadConversationMarkdown } from "@repo/ai-elements";
import type { DesktopBridge, LocalThread } from "@repo/runtime/desktop";
import { getErrorMessage } from "@repo/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export function useLocalHistory(bridge: DesktopBridge | null) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const currentPath = useRef(pathname);
  useEffect(() => {
    currentPath.current = pathname;
  }, [pathname]);
  const [threads, setThreads] = useState<LocalThread[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const revision = useRef(0);
  const load = useCallback(async () => {
    if (!bridge) return [];
    const request = ++revision.current;
    try {
      const items = await bridge.listThreads();
      if (request === revision.current) {
        setThreads(items);
        setError(null);
      }
      return items;
    } catch (cause) {
      if (request === revision.current) setError(getErrorMessage(cause));
      throw cause;
    }
  }, [bridge]);
  useEffect(() => {
    if (!bridge) return;
    let disposed = false;
    const refresh = () => void load().catch(() => {});
    const unsubscribe = bridge.subscribe((event) => {
      if (event.type === "runtime-ready" || event.type === "thread") refresh();
    });
    void bridge
      .info()
      .then((info) => {
        if (!disposed && info.localAvailable) refresh();
      })
      .catch((cause) => {
        if (!disposed) setError(getErrorMessage(cause));
      });
    return () => {
      disposed = true;
      revision.current++;
      unsubscribe();
    };
  }, [bridge, load, attempt]);

  async function remove(id: string) {
    if (!bridge) throw new Error("本地会话不可用");
    await bridge.removeThread(id);
    // Native confirmation resolves on both cancel and delete.
    const remaining = await load();
    if (!remaining.some((thread) => thread.id === id) && currentPath.current === `/platform/chat/local/${id}`) {
      void navigate("/platform/chat/conversations");
    }
  }
  async function download(id: string) {
    if (!bridge) throw new Error("本地会话不可用");
    const thread = await bridge.getThread(id);
    const title = thread.title.replace(/[\\/:*?"<>|]/g, "-").trim();
    downloadConversationMarkdown(thread.messages, `${title || "conversation"}.md`);
  }
  return { threads, remove, download, error, retry: () => setAttempt((n) => n + 1) };
}
