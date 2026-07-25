import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import {
  type Message as ApiMessage,
  authFetch,
  type ConversationDetail,
  type ConversationDocument,
  cancelConversationAgentRun,
  conversationAgentStreamUrl,
  fetchBotSkills,
  fetchConversation,
  ingestConversationDocuments,
} from "api";
import { toast } from "components";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
  type StickToBottomContext,
} from "components/ai-chat";
import {
  type PromptInputRef,
  type PromptInputValue,
  type PromptSlashCommand,
  PromptInput as RichPromptInput,
} from "components/prompt-input";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { getErrorMessage } from "shared";
import { useShallow } from "zustand/react/shallow";

import { ChatComposerControls } from "../../components/ChatComposerControls";
import { ChatContextUsage } from "../../components/ChatContextUsage";
import { ChatImagePreview } from "../../components/ChatImagePreview";
import { ChatMessageView } from "../../components/ChatMessageView";
import { collectDeliverableCompletion, findLatestUpdateTodosCallId } from "../../components/ChatTodoListCard";
import type { ChatUIMessage } from "../../lib/chat-message";
import { buildUserFilePart } from "../../lib/file-parts";
import { useChatStore } from "../../store/useChatStore";

function messageToUiMessage(message: ApiMessage): ChatUIMessage {
  const parts = message.content?.parts;
  return {
    id: message.id,
    role: message.role,
    parts: Array.isArray(parts) ? (parts as ChatUIMessage["parts"]) : [],
  };
}

function isRunning(status: ReturnType<typeof useChat<ChatUIMessage>>["status"]) {
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

function collectExecutedPlanPaths(messages: ChatUIMessage[]): Set<string> {
  const executed = new Set<string>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "data-plan-execution") {
        continue;
      }
      const path = (part.data as { path?: unknown } | undefined)?.path;
      if (typeof path === "string") {
        executed.add(path);
      }
    }
  }
  return executed;
}

function isPendingAssistantMessage(message: ChatUIMessage | undefined) {
  if (message?.role !== "assistant") {
    return false;
  }
  return message.parts.every((part) => {
    if (part.type === "text" || part.type === "reasoning") {
      return !part.text.trim();
    }
    return part.type === "step-start";
  });
}

const CHAT_STREAM_THROTTLE_MS = 50;

export function Chat() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"normal" | "plan">("normal");
  const [activatedSkillName, setActivatedSkillName] = useState<string | null>(null);
  const promptRef = useRef<PromptInputRef>(null);
  const conversationScrollRef = useRef<StickToBottomContext | null>(null);
  const resumedConversationRef = useRef<string | null>(null);
  const reconnectAbortRef = useRef<AbortController | null>(null);
  const skillCommandsCacheRef = useRef(new Map<string, PromptSlashCommand[]>());
  const skillRequestRef = useRef<{
    agentId: string;
    controller: AbortController;
    promise: Promise<PromptSlashCommand[]>;
  } | null>(null);
  const messagesRef = useRef<ChatUIMessage[]>([]);
  const titleRafRef = useRef<number | null>(null);
  const pendingTitleRef = useRef<{ id: string; title: string } | null>(null);
  const pendingClientContinuationRef = useRef(false);
  const {
    agents,
    selectedAgentId,
    setSelectedAgentId,
    traceRefreshKey,
    setTraceRun,
    clearTraceRun,
    bumpTraceRefresh,
    openArtifactPreview,
    openFilePreview,
    closeArtifactPreview,
    closeImagePreview,
    applyConversationTitle,
  } = useChatStore(
    useShallow((s) => ({
      agents: s.agents,
      selectedAgentId: s.selectedAgentId,
      setSelectedAgentId: s.setSelectedAgentId,
      traceRefreshKey: s.traceRefreshKey,
      setTraceRun: s.setTraceRun,
      clearTraceRun: s.clearTraceRun,
      bumpTraceRefresh: s.bumpTraceRefresh,
      openArtifactPreview: s.openArtifactPreview,
      openFilePreview: s.openFilePreview,
      closeArtifactPreview: s.closeArtifactPreview,
      closeImagePreview: s.closeImagePreview,
      applyConversationTitle: s.applyConversationTitle,
    })),
  );

  const requestBody = useMemo(
    () => ({
      agent_id: selectedAgentId ?? null,
      mode,
    }),
    [selectedAgentId, mode],
  );

  useEffect(() => {
    setActivatedSkillName(null);
    if (skillRequestRef.current && skillRequestRef.current.agentId !== selectedAgentId) {
      skillRequestRef.current.controller.abort();
      skillRequestRef.current = null;
    }
  }, [selectedAgentId]);

  useEffect(
    () => () => {
      skillRequestRef.current?.controller.abort();
    },
    [],
  );

  const loadSkills = useCallback(
    async (signal: AbortSignal) => {
      const agentId = selectedAgentId;
      if (!agentId) {
        return [];
      }
      const cached = skillCommandsCacheRef.current.get(agentId);
      if (cached) {
        return cached;
      }

      let request = skillRequestRef.current;
      if (!request || request.agentId !== agentId) {
        request?.controller.abort();
        const controller = new AbortController();
        const promise = fetchBotSkills(agentId, {
          signal: controller.signal,
          skipErrorNotify: true,
        })
          .then((list) =>
            list
              .filter((skill) => skill.is_enabled && skill.status === "published")
              .map((skill) => ({
                id: skill.name,
                title: skill.name,
                description: skill.description,
              })),
          )
          .then((commands) => {
            skillCommandsCacheRef.current.set(agentId, commands);
            return commands;
          })
          .catch(() => []);
        request = { agentId, controller, promise };
        skillRequestRef.current = request;
        void promise.finally(() => {
          if (skillRequestRef.current?.controller === controller) {
            skillRequestRef.current = null;
          }
        });
      }

      const list = await request.promise;
      if (signal.aborted) {
        return [];
      }
      return list;
    },
    [selectedAgentId],
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatUIMessage>({
        api: id ? conversationAgentStreamUrl(id) : "/api/chat-server/conversations/missing/agents/run/stream",
        credentials: "include",
        prepareSendMessagesRequest: ({ messages, id: chatId, body }) => ({
          body: {
            ...body,
            id: chatId,
            message: messages.at(-1),
          },
        }),
        prepareReconnectToStreamRequest: ({ api, credentials, headers }) => ({
          api,
          credentials,
          headers,
        }),
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

  const { messages, setMessages, sendMessage, stop, resumeStream, addToolOutput, addToolApprovalResponse, status } =
    useChat<ChatUIMessage>({
      id: id ?? "chat",
      transport,
      resume: false,
      experimental_throttle: CHAT_STREAM_THROTTLE_MS,
      sendAutomaticallyWhen: (options) =>
        (hasCompletedClientTool(options.messages) && lastAssistantMessageIsCompleteWithToolCalls(options)) ||
        lastAssistantMessageIsCompleteWithApprovalResponses(options),
      onError: (error) => {
        if (/abort|aborted/i.test(error.message)) {
          return;
        }
        toast.error(error.message);
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
        if (hasPendingClientTool(messagesRef.current)) {
          return;
        }
        void fetchConversation(id).then((next) => {
          setDetail({ ...next, active_run_id: null });
          setMessages(next.messages.map(messageToUiMessage));
        });
      },
    });

  useEffect(
    () => () => {
      void stop();
      reconnectAbortRef.current?.abort();
      if (titleRafRef.current !== null) {
        window.cancelAnimationFrame(titleRafRef.current);
      }
    },
    [stop],
  );

  const busy = isRunning(status);
  const showThinkingPlaceholder =
    status === "submitted" || (status === "streaming" && isPendingAssistantMessage(messages.at(-1)));
  const documents = useMemo(() => {
    const map = new Map<string, ConversationDocument>();
    for (const document of detail?.documents ?? []) {
      map.set(document.id, document);
    }
    return map;
  }, [detail?.documents]);
  const latestTodoCallId = useMemo(() => findLatestUpdateTodosCallId(messages), [messages]);
  const deliverableCompletion = useMemo(
    () => collectDeliverableCompletion(messages, latestTodoCallId),
    [messages, latestTodoCallId],
  );
  const executedPlanPaths = useMemo(() => collectExecutedPlanPaths(messages), [messages]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    closeArtifactPreview();
    closeImagePreview();
  }, [id, closeArtifactPreview, closeImagePreview]);

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
        setMessages(next.messages.map(messageToUiMessage));
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
  }, [id, setMessages, clearTraceRun, setTraceRun]);

  useEffect(() => {
    resumedConversationRef.current = null;
    pendingClientContinuationRef.current = false;
  }, [id]);

  useEffect(() => {
    if (
      !id ||
      loading ||
      detail?.id !== id ||
      busy ||
      !detail?.active_run_id ||
      resumedConversationRef.current === id
    ) {
      return;
    }
    resumedConversationRef.current = id;
    void resumeStream().catch((error) => {
      const message = getErrorMessage(error);
      if (/204|no active|not found/i.test(message)) {
        return;
      }
      // resumeStream 走 SSE(不经 axios 拦截器),错误在此提示
      toast.error(message);
    });
  }, [busy, detail?.id, detail?.active_run_id, id, loading, resumeStream]);

  async function submit(value: PromptInputValue) {
    if (busy || !id) {
      return;
    }
    pendingClientContinuationRef.current = false;
    const hasReadyFile = value.tokens.some((token) => typeof token.meta?.artifactId === "string");
    // `value.text` embeds `[[tokenId]]` placeholders for tokens; derive the real
    // typed text from text segments so an attachment-only send falls back to the
    // friendly prompt instead of shipping a raw `[[id]]` placeholder as content.
    const typedText = value.segments
      .filter((segment) => segment.type === "text")
      .map((segment) => segment.text)
      .join("")
      .trim();
    const text = typedText || (hasReadyFile ? "请阅读并处理我附加的文件。" : "");
    if (!text) {
      return;
    }
    const parts = value.segments.flatMap((segment): ChatUIMessage["parts"][number][] => {
      if (segment.type === "text") {
        return segment.text ? [{ type: "text" as const, text: segment.text }] : [];
      }
      const documentId = segment.token.meta?.artifactId;
      if (typeof documentId !== "string" || !id) {
        return [];
      }
      return [
        buildUserFilePart({
          conversationId: id,
          documentId,
          filename: segment.token.label,
          mimeType: segment.token.mime ?? "application/octet-stream",
        }),
      ];
    });
    if (!parts.some((part) => part.type === "text")) {
      parts.push({ type: "text", text });
    }
    // `/` skill activation travels as a persisted message part (one channel,
    // two roles like data-plan-execution): the backend derives the activated
    // skill from this part, and it durably records which skill drove the turn.
    if (activatedSkillName) {
      parts.push({
        type: "data-skill-activation",
        data: { name: activatedSkillName },
      });
    }
    promptRef.current?.clear();
    try {
      const sent = sendMessage({ parts }, { body: requestBody });
      // Sending always jumps to the latest message even if the user scrolled up
      // to read history (matches ChatGPT/Claude); stick-to-bottom only auto-
      // follows when already pinned, so kick the scroll explicitly here.
      conversationScrollRef.current?.scrollToBottom();
      await sent;
      setActivatedSkillName(null);
    } catch (error) {
      promptRef.current?.setValue(value);
      throw error;
    }
  }

  function changeMode(nextMode: "normal" | "plan") {
    if (busy || nextMode === mode) {
      return;
    }
    // Mode is an ephemeral per-run input carried in the run request body
    // (`requestBody.mode`); it is not persisted server-side (ADR-0035).
    setMode(nextMode);
  }

  async function stopRun() {
    const runId = useChatStore.getState().traceRunId ?? detail?.active_run_id;
    const cancelRequest = id && runId ? cancelConversationAgentRun(id, runId) : Promise.resolve(undefined);
    await stop();
    try {
      await cancelRequest;
      if (!id) {
        return;
      }
      const next = await fetchConversation(id);
      setDetail({ ...next, active_run_id: null });
      setMessages(next.messages.map(messageToUiMessage));
    } catch {}
  }

  async function executePlan(path: string) {
    if (!id || busy) {
      return;
    }
    setMode("normal");
    // Execute in normal mode this turn. `requestBody` still reflects the
    // pre-update render (mode may be "plan"), so pin mode explicitly; the plan
    // reference travels as the persisted `data-plan-execution` part.
    const sent = sendMessage(
      {
        parts: [
          { type: "text", text: "请按照这个计划开始执行。" },
          { type: "data-plan-execution", data: { path } },
        ] as ChatUIMessage["parts"],
      },
      { body: { ...requestBody, mode: "normal" as const } },
    );
    conversationScrollRef.current?.scrollToBottom();
    await sent;
  }

  function answerClientTool(toolName: string, toolCallId: string, output: unknown) {
    pendingClientContinuationRef.current = true;
    addToolOutput({
      tool: toolName,
      toolCallId,
      output: toolName === "ask_user" ? { ok: true, status: "completed", data: output } : output,
      options: { body: requestBody },
    });
  }

  function openArtifact(documentId: string) {
    if (!id) {
      return;
    }
    openArtifactPreview(id, documentId);
  }

  function openFile(path: string) {
    if (!id) {
      return;
    }
    openFilePreview(id, path);
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex h-8 shrink-0 items-center justify-center px-4">
        <h1 className="max-w-full truncate text-sm font-medium text-foreground">{detail?.title ?? "新对话"}</h1>
      </header>

      <Conversation className="min-h-0 flex-1 basis-0" contextRef={conversationScrollRef}>
        <ConversationContent className="mx-auto w-full max-w-4xl gap-6 px-4 py-2">
          {loading && messages.length === 0 ? (
            <ConversationEmptyState title="加载中" description="正在读取会话..." />
          ) : messages.length === 0 ? (
            <ConversationEmptyState title="开始对话" description="输入你的问题，或粘贴、拖入文件开始。" />
          ) : (
            messages.map((message) => (
              <ChatMessageView
                key={message.id}
                message={message}
                conversationId={id ?? ""}
                streaming={busy && message === messages.at(-1)}
                documents={documents}
                latestTodoCallId={latestTodoCallId}
                deliverableCompletion={deliverableCompletion}
                onOpenArtifact={openArtifact}
                onOpenFile={openFile}
                onAnswerClientTool={(toolName, toolCallId, output) => {
                  answerClientTool(toolName, toolCallId, output);
                }}
                onToolApproval={(approvalId, approved) => {
                  void addToolApprovalResponse({
                    id: approvalId,
                    approved,
                    options: { body: requestBody },
                  });
                }}
                onExecutePlan={(path) => void executePlan(path).catch(() => {})}
                planExecutedIds={executedPlanPaths}
                planBusy={busy}
              />
            ))
          )}
          {showThinkingPlaceholder ? (
            <div
              className="flex items-center gap-2 py-2 text-sm text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              <span className="flex gap-1" aria-hidden="true">
                <span className="size-1.5 animate-pulse rounded-full bg-current" />
                <span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
                <span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
              </span>
              正在思考…
            </div>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="mx-auto w-full max-w-4xl shrink-0 px-4 pt-2 pb-4">
        <RichPromptInput
          ref={promptRef}
          disabled={false}
          loading={busy}
          placeholder={mode === "plan" ? "描述要规划的任务，/ 引用技能，@ 添加上下文" : "要求后续变更"}
          maxFiles={8}
          maxFileSize={10 * 1024 * 1024}
          onError={(message) => toast.error(message)}
          onStop={() => void stopRun()}
          onFilesAdded={(items) => {
            if (!id) {
              return;
            }
            void ingestConversationDocuments(
              id,
              items.map(({ token, file }) => ({
                clientRef: token.id,
                file,
              })),
              {
                providerId: agents?.find((a) => a.id === selectedAgentId)?.text_provider_id ?? undefined,
              },
            )
              .then((result) => {
                for (const { client_ref: clientRef, document } of result.documents) {
                  promptRef.current?.updateToken(clientRef, {
                    meta: {
                      artifactId: document.id,
                      ingestStatus: document.ingest_status ?? "received",
                    },
                  });
                }
                for (const failure of result.failed) {
                  promptRef.current?.updateToken(failure.client_ref, {
                    meta: {
                      artifactId: failure.artifact_id ?? undefined,
                      ingestStatus: "failed",
                      ingestError: failure.error,
                    },
                  });
                  toast.error(`上传失败：${failure.error}`);
                }
              })
              .catch((error) => {
                const message = getErrorMessage(error);
                for (const { token } of items) {
                  promptRef.current?.updateToken(token.id, {
                    meta: {
                      ingestStatus: "failed",
                      ingestError: message,
                    },
                  });
                }
                toast.error(message);
              });
          }}
          onSubmit={(value) => void submit(value).catch(() => {})}
          mentionSource={(query) => {
            const q = query.trim().toLowerCase();
            return (detail?.documents ?? [])
              .filter((document) => document.kind === "source")
              .filter((document) => !q || (document.filename || document.title).toLowerCase().includes(q))
              .slice(0, 8)
              .map((document) => ({
                id: document.id,
                label: document.filename || document.title,
                kind: (document.mime_type ?? "").startsWith("image/") ? "image" : "file",
                mime: document.mime_type,
                meta: { artifactId: document.id },
              }));
          }}
          onSkillsLoad={loadSkills}
          onSlashCommand={(command) => {
            setActivatedSkillName(command.id);
            toast(`已选择技能：${command.title}`);
          }}
          footerRender={() => (
            <>
              <ChatComposerControls
                agents={agents ?? []}
                selectedAgentId={selectedAgentId}
                onSelectAgent={setSelectedAgentId}
                activatedSkillName={activatedSkillName}
                onClearSkill={() => setActivatedSkillName(null)}
                mode={mode}
                onModeChange={changeMode}
                disabled={busy}
              />
              <ChatContextUsage conversationId={id ?? ""} refreshKey={traceRefreshKey} running={busy} />
            </>
          )}
        />
      </div>
      <ChatImagePreview />
    </div>
  );
}
