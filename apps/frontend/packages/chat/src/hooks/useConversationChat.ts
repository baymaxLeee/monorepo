import { Chat } from "@ai-sdk/react";
import {
  authFetch,
  type ConversationDetail,
  cancelConversationAgentRun,
  fetchConversation,
  selectConversationHistory,
} from "@repo/api";
import { getErrorMessage } from "@repo/shared";
import { lastAssistantMessageIsCompleteWithApprovalResponses, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { chatDataPartSchemas, chatMessageMetadataSchema, type ChatUIMessage } from "../lib/chat-message";
import {
  hasCompletedClientTool,
  hasPendingClientTool,
  validateConversationMessages,
} from "../lib/conversation-messages";
import { createConversationTransport } from "../lib/transport";
import { useChatStore } from "../store/useChatStore";

function isRunning(status: Chat<ChatUIMessage>["status"]) {
  return status === "streaming" || status === "submitted";
}

function messagesSnapshotKey(messages: ChatUIMessage[]): string {
  return JSON.stringify(messages);
}

export function useConversationChat(id: string) {
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [issue, setIssue] = useState<{ kind: "connection" | "history" | "cancel"; message: string } | null>(null);
  const refreshRef = useRef<(() => Promise<void>) | null>(null);
  const titleRafRef = useRef<number | null>(null);
  const pendingTitleRef = useRef<{ id: string; title: string } | null>(null);
  const pendingClientContinuationRef = useRef(false);
  const historyRevisionRef = useRef<number | undefined>(undefined);
  const connectedChatRef = useRef<Chat<ChatUIMessage> | null>(null);
  const historySelectionRef = useRef(0);
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
        getExpectedRevision: () => historyRevisionRef.current,
        fetch: async (input, init) => {
          const response = await authFetch(input, init);
          if (init?.method === "GET" && response.status === 204) await refreshRef.current?.();
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
        messageMetadataSchema: chatMessageMetadataSchema,
        dataPartSchemas: chatDataPartSchemas,
        sendAutomaticallyWhen: (options) =>
          pendingClientContinuationRef.current &&
          ((hasCompletedClientTool(options.messages) && lastAssistantMessageIsCompleteWithToolCalls(options)) ||
            lastAssistantMessageIsCompleteWithApprovalResponses(options)),
        onError: (error) => {
          if (error.name !== "AbortError" && connectedChatRef.current === chat) {
            setIssue({ kind: "connection", message: error.message });
          }
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
        onFinish: ({ isDisconnect, isError, isAbort }) => {
          if (connectedChatRef.current !== chat) return;
          bumpTraceRefresh();
          const streamedRevision = chat.messages.at(-1)?.metadata?.historyRevision;
          if (streamedRevision !== undefined)
            historyRevisionRef.current = Math.max(historyRevisionRef.current ?? 0, streamedRevision);
          if (!id) {
            return;
          }
          if (isAbort) return;
          if (isError || isDisconnect) {
            // Fetch only the authoritative run/revision. Keep the partial reply
            // and any unsent client result available for recovery.
            const snapshot = messagesSnapshotKey(chat.messages);
            void fetchConversation(id, { skipErrorNotify: true })
              .then((next) => {
                if (connectedChatRef.current !== chat || messagesSnapshotKey(chat.messages) !== snapshot) return;
                if (next.revision < (historyRevisionRef.current ?? 0)) return;
                historyRevisionRef.current = next.revision;
                setDetail(next);
              })
              .catch(() => {});
            return;
          }
          const responseReady =
            pendingClientContinuationRef.current &&
            (hasCompletedClientTool(chat.messages) ||
              lastAssistantMessageIsCompleteWithApprovalResponses({ messages: chat.messages }));
          if (!responseReady) pendingClientContinuationRef.current = false;
          transport.clearPendingRequest?.();
          setIssue(null);
          // A client tool (ask_user) pause fires onFinish too. Re-syncing messages
          // from the DB here would clobber the in-memory tool output the user is
          // about to submit (or just submitted) before the auto-continuation POST
          // reads it, dropping the answer. Skip the resync while an answer is pending.
          const preserveClientTool = responseReady || hasPendingClientTool(chat.messages);
          const finishedMessagesKey = messagesSnapshotKey(chat.messages);
          void fetchConversation(id, { skipErrorNotify: true })
            .then(async (next) => {
              const messages = await validateConversationMessages(next.messages);
              if (connectedChatRef.current !== chat || messagesSnapshotKey(chat.messages) !== finishedMessagesKey)
                return;
              if (next.revision < (historyRevisionRef.current ?? 0)) return;
              historyRevisionRef.current = next.revision;
              setDetail(next);
              if (!preserveClientTool && !next.active_run_id) chat.messages = messages;
            })
            .catch((error: unknown) => {
              if (connectedChatRef.current === chat)
                setIssue({ kind: "history", message: getErrorMessage(error, "消息保存状态未确认，请重新同步。") });
            });
        },
      }),
    [id, transport, scheduleConversationTitle, bumpTraceRefresh],
  );

  useEffect(() => {
    connectedChatRef.current = chat;
    return () => {
      connectedChatRef.current = null;
      void chat.stop();
      if (titleRafRef.current !== null) window.cancelAnimationFrame(titleRafRef.current);
    };
  }, [chat]);

  useEffect(() => {
    if (!id) {
      return;
    }
    let active = true;
    setLoading(true);
    setDetail(null);
    setIssue(null);
    historyRevisionRef.current = undefined;
    clearTraceRun();
    fetchConversation(id, { skipErrorNotify: true })
      .then(async (next) => {
        const messages = await validateConversationMessages(next.messages);
        if (!active) {
          return;
        }
        setDetail(next);
        historyRevisionRef.current = next.revision;
        chat.messages = messages;
        const latestRunId = next.active_run_id ?? next.latest_run_id;
        if (latestRunId) {
          setTraceRun(id, latestRunId);
        }
      })
      .catch((error: unknown) => {
        if (active) setIssue({ kind: "history", message: getErrorMessage(error) });
      })
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
    pendingClientContinuationRef.current = false;
  }, [id]);

  const refresh = useCallback(async () => {
    const snapshot = messagesSnapshotKey(chat.messages);
    const next = await fetchConversation(id, { skipErrorNotify: true });
    const messages = await validateConversationMessages(next.messages);
    if (connectedChatRef.current !== chat || messagesSnapshotKey(chat.messages) !== snapshot || isRunning(chat.status))
      return;
    if (next.revision < (historyRevisionRef.current ?? 0)) return;
    historyRevisionRef.current = next.revision;
    setDetail(next);
    const pending = transport.getPendingRequest?.();
    // An unchanged revision proves the POST was never claimed. Keep its exact
    // local input for the explicit retry action, including edit/regenerate IDs.
    if (pending && next.revision === pending.body.expected_revision) return;
    if (next.active_run_id || (pendingClientContinuationRef.current && !pending)) return;
    pendingClientContinuationRef.current = false;
    chat.messages = messages;
    transport.clearPendingRequest?.();
    chat.clearError();
    setIssue(null);
  }, [chat, id, transport]);
  useEffect(() => {
    refreshRef.current = refresh;
    return () => {
      refreshRef.current = null;
    };
  }, [refresh]);

  const recover = useCallback(async () => {
    try {
      await chat.resumeStream();
      if (!isRunning(chat.status)) await refresh();
    } catch (error) {
      if (connectedChatRef.current === chat) setIssue({ kind: "connection", message: getErrorMessage(error) });
    }
  }, [chat, refresh]);

  const retryRequest = useCallback(async () => {
    const pending = transport.getPendingRequest?.();
    if (!pending || isRunning(chat.status)) return;
    try {
      const next = await fetchConversation(id, { skipErrorNotify: true });
      if (connectedChatRef.current !== chat) return;
      if (next.active_run_id || next.revision !== pending.body.expected_revision) {
        await recover();
        return;
      }
      chat.messages = pending.messages;
      transport.prepareRetry();
      setIssue(null);
      await chat.sendMessage();
    } catch (error) {
      if (connectedChatRef.current === chat) setIssue({ kind: "connection", message: getErrorMessage(error) });
    }
  }, [chat, id, recover, transport]);

  const stopRun = useCallback(async () => {
    const runId = detail?.active_run_id ?? useChatStore.getState().traceRunId;
    await chat.stop();
    try {
      if (runId) {
        const result = await cancelConversationAgentRun(id, runId, { skipErrorNotify: true });
        if (result?.status === "running" || result?.status === "cancel_requested")
          throw new Error("停止请求已提交，服务端尚未确认结束。请重试确认。");
      }
      pendingClientContinuationRef.current = false;
      await refresh();
    } catch (error) {
      if (connectedChatRef.current === chat)
        setIssue({ kind: "cancel", message: getErrorMessage(error, "停止未确认，请重试。") });
    }
  }, [id, detail?.active_run_id, chat, refresh]);

  const selectHistory = useCallback(
    async (leafMessageId: string) => {
      const expectedRevision = historyRevisionRef.current;
      if (!id || expectedRevision === undefined || isRunning(chat.status)) {
        throw new Error("当前无法切换消息候选");
      }
      const selection = ++historySelectionRef.current;
      const next = await selectConversationHistory(id, {
        leaf_message_id: leafMessageId,
        expected_revision: expectedRevision,
      });
      const messages = await validateConversationMessages(next.messages);
      if (
        connectedChatRef.current !== chat ||
        historySelectionRef.current !== selection ||
        historyRevisionRef.current !== expectedRevision ||
        isRunning(chat.status)
      ) {
        return;
      }
      historyRevisionRef.current = next.revision;
      setDetail(next);
      chat.messages = messages;
    },
    [chat, id],
  );

  return {
    chat,
    detail,
    loading,
    issue,
    canRetry: transport.getPendingRequest?.() != null,
    recover,
    retryRequest,
    stopRun,
    selectHistory,
    pendingClientContinuationRef,
  };
}
