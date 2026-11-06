import { Chat } from "@ai-sdk/react";
import {
  type Message as ApiMessage,
  authFetch,
  type ConversationDetail,
  cancelConversationAgentRun,
  fetchConversation,
} from "@repo/api";
import { toast } from "@repo/design-system";
import { getErrorMessage } from "@repo/shared";
import { lastAssistantMessageIsCompleteWithApprovalResponses, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import type { ChatUIMessage } from "../lib/chat-message";
import { createConversationTransport } from "../lib/transport";
import { useChatStore } from "../store/useChatStore";

function messageToUiMessage(message: ApiMessage): ChatUIMessage {
  const parts = message.content?.parts;
  return {
    id: message.id,
    role: message.role,
    parts: Array.isArray(parts) ? (parts as ChatUIMessage["parts"]) : [],
  };
}

function isRunning(status: Chat<ChatUIMessage>["status"]) {
  return status === "streaming" || status === "submitted";
}

function hasPendingClientTool(messages: ChatUIMessage[]): boolean {
  const last = messages.at(-1);
  if (last?.role !== "assistant") {
    return false;
  }
  return last.parts.some(
    (part) =>
      part.type.startsWith("tool-") &&
      "state" in part &&
      (part.state === "input-available" || part.state === "approval-requested"),
  );
}

function hasCompletedClientTool(messages: ChatUIMessage[]): boolean {
  const last = messages.at(-1);
  if (last?.role !== "assistant") {
    return false;
  }
  const lastStepStartIndex = last.parts.reduce(
    (index, part, currentIndex) => (part.type === "step-start" ? currentIndex : index),
    -1,
  );
  return last.parts.slice(lastStepStartIndex + 1).some((part) => {
    if (!part.type.startsWith("tool-") || !("state" in part)) {
      return false;
    }
    const metadata = "toolMetadata" in part ? part.toolMetadata : undefined;
    const agent = metadata && typeof metadata === "object" && "agent" in metadata ? metadata.agent : undefined;
    return (
      agent &&
      typeof agent === "object" &&
      "execution" in agent &&
      agent.execution === "client" &&
      ["output-available", "output-error", "output-denied"].includes(String(part.state))
    );
  });
}

export function useConversationChat(id: string) {
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const resumedConversationRef = useRef<string | null>(null);
  const reconnectAbortRef = useRef<AbortController | null>(null);
  const titleRafRef = useRef<number | null>(null);
  const pendingTitleRef = useRef<{ id: string; title: string } | null>(null);
  const pendingClientContinuationRef = useRef(false);
  const connectedChatRef = useRef<Chat<ChatUIMessage> | null>(null);
  const { setTraceRun, clearTraceRun, bumpTraceRefresh, applyConversationTitle } = useChatStore(
    useShallow((s) => ({
      setTraceRun: s.setTraceRun,
      clearTraceRun: s.clearTraceRun,
      bumpTraceRefresh: s.bumpTraceRefresh,
      applyConversationTitle: s.applyConversationTitle,
    })),
  );
  const transport = useMemo(
    () =>
      createConversationTransport<ChatUIMessage>(id ?? "missing", {
        fetch: async (input, init) => {
          let requestInit = init;
          if (init?.method === "GET" && !init.signal) {
            reconnectAbortRef.current?.abort();
            const controller = new AbortController();
            reconnectAbortRef.current = controller;
            requestInit = { ...init, signal: controller.signal };
          }
          let response = await authFetch(input, requestInit);
          if (response.status === 401) {
            response = await authFetch(input, requestInit);
          }
          const runId = response.headers.get("x-agent-run-id");
          if (runId && id) {
            setTraceRun(id, runId);
          }
          return response;
        },
      }),
    [id, setTraceRun],
  );

  const scheduleConversationTitle = useCallback(
    (conversationId: string, title: string) => {
      pendingTitleRef.current = { id: conversationId, title };
      if (titleRafRef.current !== null) {
        return;
      }
      titleRafRef.current = window.requestAnimationFrame(() => {
        titleRafRef.current = null;
        const pending = pendingTitleRef.current;
        pendingTitleRef.current = null;
        if (!pending) {
          return;
        }
        setDetail((current) => {
          if (!current || current.id !== pending.id || current.title === pending.title) {
            return current;
          }
          return { ...current, title: pending.title };
        });
        applyConversationTitle(pending.id, pending.title);
      });
    },
    [applyConversationTitle],
  );

  const chat: Chat<ChatUIMessage> = useMemo(
    () =>
      new Chat<ChatUIMessage>({
        id: id ?? "chat",
        transport,
        sendAutomaticallyWhen: (options) =>
          (hasCompletedClientTool(options.messages) && lastAssistantMessageIsCompleteWithToolCalls(options)) ||
          lastAssistantMessageIsCompleteWithApprovalResponses(options),
        onError: (error) => {
          if (/abort|aborted/i.test(error.message)) {
            return;
          }
          toast.add({ type: "error", title: error.message });
        },
        onData: (dataPart) => {
          if (dataPart.type !== "data-conversation-title") {
            return;
          }
          const title = dataPart.data.title.trim();
          if (!title || !id) {
            return;
          }
          scheduleConversationTitle(id, title);
        },
        onFinish: ({ isError }) => {
          if (connectedChatRef.current !== chat) return;
          bumpTraceRefresh();
          if (!id) {
            return;
          }
          if (isError && pendingClientContinuationRef.current) {
            return;
          }
          pendingClientContinuationRef.current = false;
          // A client tool (ask_user) pause fires onFinish too. Re-syncing messages
          // from the DB here would clobber the in-memory tool output the user is
          // about to submit (or just submitted) before the auto-continuation POST
          // reads it, dropping the answer. Skip the resync while an answer is pending.
          if (hasPendingClientTool(chat.messages)) {
            return;
          }
          void fetchConversation(id)
            .then((next) => {
              if (connectedChatRef.current !== chat) return;
              setDetail({ ...next, active_run_id: null });
              chat.messages = next.messages.map(messageToUiMessage);
            })
            .catch(() => {});
        },
      }),
    [id, transport, scheduleConversationTitle, bumpTraceRefresh],
  );

  useEffect(() => {
    connectedChatRef.current = chat;
    return () => {
      connectedChatRef.current = null;
      void chat.stop();
      reconnectAbortRef.current?.abort();
      if (titleRafRef.current !== null) window.cancelAnimationFrame(titleRafRef.current);
    };
  }, [chat]);

  useEffect(() => {
    if (!id) {
      return;
    }
    let active = true;
    setLoading(true);
    clearTraceRun();
    fetchConversation(id)
      .then((next) => {
        if (!active) {
          return;
        }
        setDetail(next);
        chat.messages = next.messages.map(messageToUiMessage);
        const latestRunId = next.active_run_id ?? next.latest_run_id;
        if (latestRunId) {
          setTraceRun(id, latestRunId);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [id, chat, clearTraceRun, setTraceRun]);

  useEffect(() => {
    resumedConversationRef.current = null;
    pendingClientContinuationRef.current = false;
  }, [id]);

  useEffect(() => {
    if (
      !id ||
      loading ||
      detail?.id !== id ||
      isRunning(chat.status) ||
      !detail?.active_run_id ||
      resumedConversationRef.current === id
    ) {
      return;
    }
    resumedConversationRef.current = id;
    void chat.resumeStream().catch((error) => {
      if (connectedChatRef.current !== chat) return;
      const message = getErrorMessage(error);
      if (/204|no active|not found/i.test(message)) {
        return;
      }
      // resumeStream 走 SSE(不经 axios 拦截器),错误在此提示
      toast.add({ type: "error", title: message });
    });
  }, [chat, detail?.id, detail?.active_run_id, id, loading]);

  const stopRun = useCallback(async () => {
    const runId = useChatStore.getState().traceRunId ?? detail?.active_run_id;
    const cancelRequest = id && runId ? cancelConversationAgentRun(id, runId) : Promise.resolve(undefined);
    await chat.stop();
    try {
      await cancelRequest;
      if (!id) {
        return;
      }
      const next = await fetchConversation(id);
      if (connectedChatRef.current !== chat) return;
      setDetail({ ...next, active_run_id: null });
      chat.messages = next.messages.map(messageToUiMessage);
    } catch {}
  }, [id, detail?.active_run_id, chat]);

  return { chat, detail, loading, stopRun, pendingClientContinuationRef };
}
