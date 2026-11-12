import { downloadConversationMarkdown } from "@repo/ai-elements";
import { useChatStore } from "@repo/ai-elements/conversation/store/useChatStore";
import {
  type Conversation,
  createConversation,
  deleteConversation,
  fetchConversation,
  fetchConversations,
} from "@repo/api";
import { getErrorMessage } from "@repo/shared";
import type { UIMessage } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export function useConversationHistory() {
  const navigate = useNavigate();
  const { pathname, state: navigationState } = useLocation();
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const mounted = useRef(false);
  const creatingRef = useRef(false);
  const revision = useRef(0);
  const currentPath = useRef(pathname);
  useEffect(() => {
    currentPath.current = pathname;
  }, [pathname]);
  const titleUpdate = useChatStore((s) => s.conversationTitleUpdate);
  const load = useCallback(async () => {
    const requestRevision = ++revision.current;
    setError(null);
    try {
      const list = await fetchConversations();
      if (mounted.current && revision.current === requestRevision) {
        const update = useChatStore.getState().conversationTitleUpdate;
        setConversations(
          update ? list.map((item) => (item.id === update.id ? { ...item, title: update.title } : item)) : list,
        );
      }
      return list;
    } catch (cause) {
      if (mounted.current && revision.current === requestRevision) setError(getErrorMessage(cause, "无法加载会话"));
      return null;
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);
  useEffect(() => {
    if (navigationState?.refreshConversationHistory) void load();
  }, [load, navigationState]);
  useEffect(() => {
    if (!titleUpdate) return;
    setConversations(
      (list) =>
        list?.map((item) => (item.id === titleUpdate.id ? { ...item, title: titleUpdate.title } : item)) ?? null,
    );
  }, [titleUpdate]);

  const create = useCallback(async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    try {
      const item = await createConversation({});
      if (!mounted.current) return;
      revision.current++;
      setConversations((list) => [item, ...(list ?? [])]);
      navigate(`/platform/chat/conversations/${item.id}`);
    } finally {
      creatingRef.current = false;
      if (mounted.current) setCreating(false);
    }
  }, [navigate]);
  const remove = useCallback(
    async (id: string) => {
      await deleteConversation(id);
      if (!mounted.current) return;
      revision.current++;
      setConversations((list) => list?.filter((item) => item.id !== id) ?? null);
      if (currentPath.current.endsWith(`/${id}`)) navigate("/platform/chat/conversations");
    },
    [navigate],
  );
  const download = useCallback(async (id: string) => {
    const detail = await fetchConversation(id);
    const messages: UIMessage[] = detail.messages.map((message) => ({
      id: message.id,
      role: message.role,
      parts: Array.isArray(message.content.parts) ? (message.content.parts as UIMessage["parts"]) : [],
    }));
    const title = detail.title.replace(/[\\/:*?"<>|]/g, "-").trim();
    downloadConversationMarkdown(messages, `${title || "conversation"}.md`);
  }, []);
  return { conversations, error, creating, load, create, remove, download, pathname };
}
