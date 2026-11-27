import { Chat } from "@ai-sdk/react";
import { authFetch } from "@repo/api";
import {
  type ConversationDetail,
  cancelConversationAgentRun,
  getConversation,
  selectConversationHistory,
} from "@repo/api/chat";
import { getErrorMessage } from "@repo/shared";
import { lastAssistantMessageIsCompleteWithApprovalResponses, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  chatDataPartSchemas,
  chatMessageMetadataSchema,
  type ChatUIDataTypes,
  type ChatUIMessage,
} from "../lib/chat-message";
import {
  hasCompletedClientTool,
  hasPendingClientTool,
  validateConversationMessages,
} from "../lib/conversation-messages";
import { PageToolSession, type ClientToolExecutor } from "../lib/page-tools";
import { createConversationTransport } from "../lib/transport";
import { useChatStore } from "../store/useChatStore";

function isRunning(status: Chat<ChatUIMessage>["status"]) {
  return status === "streaming" || status === "submitted";
}

function messagesSnapshotKey(messages: ChatUIMessage[]): string {
  return JSON.stringify(messages);
}

export function useConversationChat(id: string, executor?: ClientToolExecutor, requestBody?: Record<string, unknown>) {
  const page = useMemo(() => executor && new PageToolSession(executor), [id, executor]);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyReady, setHistoryReady] = useState(false);
  const [historyMutationPending, setHistoryMutationPending] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [issue, setIssue] = useState<{ kind: "connection" | "history" | "cancel"; message: string } | null>(null);
  const [modelRetry, setModelRetry] = useState<ChatUIDataTypes["model-retry"] | null>(null);
  const [contextCompaction, setContextCompaction] = useState<ChatUIDataTypes["context-compaction"] | null>(null);
  const [contextUsage, setContextUsage] = useState<ChatUIDataTypes["context-usage"] | null>(null);
  const [streamProbe, setStreamProbe] = useState<{ runId: string | null; sequence: number } | null>(null);
  const streamProbeSequenceRef = useRef(0);
  const probeDelayRef = useRef(2000);
  const titleRafRef = useRef<number | null>(null);
  const pendingTitleRef = useRef<{ id: string; title: string } | null>(null);
  const pendingClientContinuationRef = useRef(false);
  const historyRevisionRef = useRef<number | undefined>(undefined);
  const connectedChatRef = useRef<Chat<ChatUIMessage> | null>(null);
  const historySelectionRef = useRef(0);
  const historySelectionPendingRef = useRef(false);
  const retryRequestPendingRef = useRef(false);
  const { setTraceRun, clearTraceRun, bumpTraceRefresh, applyConversationTitle } = useChatStore(
    useShallow((s) => ({
      setTraceRun: s.setTraceRun,
      clearTraceRun: s.clearTraceRun,
      bumpTraceRefresh: s.bumpTraceRefresh,
      applyConversationTitle: s.applyConversationTitle,
    })),
  );
  useEffect(() => {
    setModelRetry(null);
    setContextCompaction(null);
    setContextUsage(null);
    setStreamProbe(null);
    streamProbeSequenceRef.current = 0;
    probeDelayRef.current = 2000;
  }, [id]);
  const transport = useMemo(
    () =>
      createConversationTransport<ChatUIMessage>(id ?? "missing", {
        getExpectedRevision: () => historyRevisionRef.current,
        fetch: async (input, init) => {
          const response = await authFetch(input, init);
          const runId = response.headers.get("x-agent-run-id");
          if (runId && id) {
            setActiveRunId(runId);
            setTraceRun(id, runId);
          }
          const method = init?.method?.toUpperCase();
          const runState = response.headers.get("x-agent-run-state");
          if (method === "GET") {
            if (response.status === 204) {
              setStreamProbe({ runId, sequence: ++streamProbeSequenceRef.current });
            } else if (response.ok) {
              probeDelayRef.current = 2000;
              setStreamProbe(null);
              setIssue(null);
            }
          } else if (method === "POST" && response.status === 409 && runId) {
            if (runState === "active-detached" || runState === "settled") {
              setStreamProbe({
                runId: runState === "settled" ? null : runId,
                sequence: ++streamProbeSequenceRef.current,
              });
            }
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
        transport: page?.transport(transport) ?? transport,
        onToolCall: ({ toolCall }) => {
          void page
            ?.respond(toolCall, (result) => {
              pendingClientContinuationRef.current = true;
              return chat.addToolOutput({ ...result, options: { body: requestBody } });
            })
            .catch((error) => {
              if (connectedChatRef.current === chat) setIssue({ kind: "connection", message: getErrorMessage(error) });
            });
        },
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
          if (dataPart.type === "data-model-retry") {
            setModelRetry(dataPart.data.state === "recovered" ? null : dataPart.data);
            return;
          }
          if (dataPart.type === "data-context-compaction") {
            setContextCompaction(dataPart.data.state === "completed" ? null : dataPart.data);
            return;
          }
          if (dataPart.type === "data-context-usage") {
            setContextUsage(dataPart.data);
            return;
          }
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
          setModelRetry(null);
          setContextCompaction(null);
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
            void getConversation(id, { skipErrorNotify: true })
              .then((next) => {
                if (connectedChatRef.current !== chat || messagesSnapshotKey(chat.messages) !== snapshot) return;
                if (next.revision < (historyRevisionRef.current ?? 0)) return;
                historyRevisionRef.current = next.revision;
                setActiveRunId(next.active_run_id);
                setDetail(next);
                if (isDisconnect && next.active_run_id) {
                  setStreamProbe({ runId: next.active_run_id, sequence: ++streamProbeSequenceRef.current });
                }
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
          void getConversation(id, { skipErrorNotify: true })
            .then(async (next) => {
              const messages = await validateConversationMessages(next.messages);
              if (connectedChatRef.current !== chat || messagesSnapshotKey(chat.messages) !== finishedMessagesKey)
                return;
              if (next.revision < (historyRevisionRef.current ?? 0)) return;
              historyRevisionRef.current = next.revision;
              setHistoryReady(true);
              setActiveRunId(next.active_run_id);
              setDetail(next);
              if (!preserveClientTool && !next.active_run_id) chat.messages = messages;
            })
            .catch((error: unknown) => {
              if (connectedChatRef.current === chat)
                setIssue({ kind: "history", message: getErrorMessage(error, "消息保存状态未确认，请重新同步。") });
            });
        },
      }),
    [id, transport, page, requestBody, scheduleConversationTitle, bumpTraceRefresh],
  );

  useEffect(() => {
    connectedChatRef.current = chat;
    return () => {
      page?.stop();
      connectedChatRef.current = null;
      void chat.stop();
      if (titleRafRef.current !== null) window.cancelAnimationFrame(titleRafRef.current);
    };
  }, [chat, page]);

  useEffect(() => {
    if (!id) {
      return;
    }
    let active = true;
    setLoading(true);
    setHistoryReady(false);
    setHistoryMutationPending(false);
    setActiveRunId(null);
    setDetail(null);
    setIssue(null);
    setModelRetry(null);
    historyRevisionRef.current = undefined;
    historySelectionRef.current++;
    historySelectionPendingRef.current = false;
    retryRequestPendingRef.current = false;
    clearTraceRun();
    getConversation(id, { skipErrorNotify: true })
      .then(async (next) => {
        const messages = await validateConversationMessages(next.messages);
        if (!active) {
          return;
        }
        setDetail(next);
        setActiveRunId(next.active_run_id);
        historyRevisionRef.current = next.revision;
        setHistoryReady(true);
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
    const next = await getConversation(id, { skipErrorNotify: true });
    const messages = await validateConversationMessages(next.messages);
    if (connectedChatRef.current !== chat || messagesSnapshotKey(chat.messages) !== snapshot || isRunning(chat.status))
      return;
    if (next.revision < (historyRevisionRef.current ?? 0)) return;
    historyRevisionRef.current = next.revision;
    setHistoryReady(true);
    setActiveRunId(next.active_run_id);
    setDetail(next);
    const pending = transport.getPendingRequest?.();
    // An unchanged revision proves the POST was never claimed. Keep its exact
    // local input for the explicit retry action, including edit/regenerate IDs.
    if (pending && next.revision === pending.body.expected_revision) return;
    if (next.active_run_id) {
      if (!pending && !pendingClientContinuationRef.current) {
        chat.messages = messages;
        chat.clearError();
        setIssue(null);
      }
      return;
    }
    if (pendingClientContinuationRef.current && !pending) return;
    pendingClientContinuationRef.current = false;
    chat.messages = messages;
    transport.clearPendingRequest?.();
    chat.clearError();
    setIssue(null);
  }, [chat, id, transport]);
  useEffect(() => {
    if (!streamProbe) return;
    if (isRunning(chat.status)) {
      return chat["~registerStatusCallback"](() => {
        if (!isRunning(chat.status)) setStreamProbe((current) => (current === streamProbe ? { ...current } : current));
      });
    }
    if (!streamProbe.runId) {
      setStreamProbe(null);
      probeDelayRef.current = 2000;
      void refresh().catch((error: unknown) => {
        if (connectedChatRef.current === chat)
          setIssue({ kind: "connection", message: getErrorMessage(error, "任务状态同步失败，请重试。") });
      });
      return;
    }
    const timer = setTimeout(() => {
      if (connectedChatRef.current === chat && !isRunning(chat.status)) {
        probeDelayRef.current = Math.min(probeDelayRef.current * 2, 30_000);
        void chat.resumeStream().catch((error: unknown) => {
          if (connectedChatRef.current === chat)
            setIssue({ kind: "connection", message: getErrorMessage(error, "任务恢复失败，请重试。") });
        });
      }
    }, probeDelayRef.current);
    return () => clearTimeout(timer);
  }, [chat, refresh, streamProbe]);

  const recover = useCallback(async () => {
    try {
      const probeSequence = streamProbeSequenceRef.current;
      await chat.resumeStream();
      // Custom transports and older hosts may not report stream state headers.
      // Explicit user recovery retains one authoritative fallback read.
      if (streamProbeSequenceRef.current === probeSequence && !isRunning(chat.status)) await refresh();
    } catch (error) {
      if (connectedChatRef.current === chat) setIssue({ kind: "connection", message: getErrorMessage(error) });
    }
  }, [chat, refresh]);

  const canStartHistoryMutation = useCallback(
    () =>
      connectedChatRef.current === chat &&
      historyRevisionRef.current !== undefined &&
      !historySelectionPendingRef.current &&
      !retryRequestPendingRef.current &&
      !isRunning(chat.status),
    [chat],
  );

  const retryRequest = useCallback(async () => {
    const pending = transport.getPendingRequest?.();
    if (!pending || !canStartHistoryMutation()) return;
    retryRequestPendingRef.current = true;
    setHistoryMutationPending(true);
    try {
      const next = await getConversation(id, { skipErrorNotify: true });
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
    } finally {
      if (connectedChatRef.current === chat) {
        retryRequestPendingRef.current = false;
        setHistoryMutationPending(historySelectionPendingRef.current);
      }
    }
  }, [canStartHistoryMutation, chat, id, recover, transport]);

  const stopRun = useCallback(async () => {
    page?.stop();
    await chat.stop();
    try {
      const authoritative = await getConversation(id, { skipErrorNotify: true });
      const runId =
        authoritative.active_run_id ??
        chat.messages.at(-1)?.metadata?.runId ??
        detail?.active_run_id ??
        useChatStore.getState().traceRunId;
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
  }, [id, detail?.active_run_id, chat, refresh, page]);

  const selectHistory = useCallback(
    async (leafMessageId: string) => {
      const expectedRevision = historyRevisionRef.current;
      if (!id || expectedRevision === undefined || !canStartHistoryMutation()) {
        throw new Error("当前无法切换消息候选");
      }
      const selection = ++historySelectionRef.current;
      const snapshot = messagesSnapshotKey(chat.messages);
      historySelectionPendingRef.current = true;
      setHistoryMutationPending(true);
      try {
        const next = await selectConversationHistory(id, {
          leaf_message_id: leafMessageId,
          expected_revision: expectedRevision,
        });
        const messages = await validateConversationMessages(next.messages);
        if (
          connectedChatRef.current !== chat ||
          historySelectionRef.current !== selection ||
          historyRevisionRef.current !== expectedRevision ||
          messagesSnapshotKey(chat.messages) !== snapshot ||
          isRunning(chat.status)
        ) {
          return;
        }
        historyRevisionRef.current = next.revision;
        setHistoryReady(true);
        setDetail(next);
        chat.messages = messages;
      } finally {
        if (connectedChatRef.current === chat && historySelectionRef.current === selection) {
          historySelectionPendingRef.current = false;
          setHistoryMutationPending(retryRequestPendingRef.current);
        }
      }
    },
    [canStartHistoryMutation, chat, id],
  );

  return {
    chat,
    detail,
    loading,
    historyReady,
    historyMutationPending,
    activeRunId,
    issue,
    modelRetry,
    contextCompaction,
    contextUsage,
    canRetry: transport.getPendingRequest?.() != null && !retryRequestPendingRef.current,
    canStartHistoryMutation,
    recover,
    retryRequest,
    stopRun,
    selectHistory,
    pendingClientContinuationRef,
  };
}
