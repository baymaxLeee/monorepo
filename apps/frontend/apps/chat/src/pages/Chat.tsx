import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import {
  type Message as ApiMessage,
  type ConversationDetail,
  type ConversationDocument,
  cancelConversationAgentRun,
  chatAuthHeaders,
  conversationAgentStreamUrl,
  type DocumentIngestStreamEvent,
  fetchConversation,
  streamKnowledgeIngest,
  updateConversationMode,
} from "api";
import { toast } from "components";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "components/ai-chat";
import {
  type PromptInputRef,
  type PromptInputValue,
  PromptInput as RichPromptInput,
} from "components/prompt-input";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { ChatComposerControls } from "../components/ChatComposerControls";
import { ChatMessageView } from "../components/ChatMessageView";
import { findLatestUpdateTodosCallId } from "../components/ChatTodoListCard";
import type { ChatUIMessage } from "../lib/chat-message";
import { buildUserFilePart } from "../lib/file-parts";
import { useChatStore } from "../store/useChatStore";

function messageToUiMessage(message: ApiMessage): ChatUIMessage {
  const parts = message.content?.parts;
  return {
    id: message.id,
    role: message.role,
    parts: Array.isArray(parts) ? (parts as ChatUIMessage["parts"]) : [],
  };
}

function isRunning(
  status: ReturnType<typeof useChat<ChatUIMessage>>["status"],
) {
  return status === "streaming" || status === "submitted";
}

// AI SDK flips `status` to "streaming" as soon as the response begins
// arriving, which can be well before the model's first visible token (TTFT,
// extended thinking, or a provider that opens the connection before it has
// anything to say). Treat a freshly-appended assistant message with no
// renderable content yet as still "waiting", so the placeholder below
// bridges submitted -> streaming -> first visible part instead of only
// covering submitted.
function isPendingAssistantMessage(message: ChatUIMessage | undefined) {
  if (message?.role !== "assistant") return false;
  return message.parts.every((part) => {
    if (part.type === "text" || part.type === "reasoning") {
      return !part.text.trim();
    }
    return part.type === "step-start";
  });
}

export function Chat() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [thinking, setThinking] = useState(false);
  const [mode, setMode] = useState<"normal" | "plan">("normal");
  const promptRef = useRef<PromptInputRef>(null);
  const resumedConversationRef = useRef<string | null>(null);
  const {
    providers,
    selectedProviderId,
    setSelectedProviderId,
    selectedImageProviderId,
    setSelectedImageProviderId,
    selectedVideoProviderId,
    setSelectedVideoProviderId,
    loadProviders,
    setTraceRun,
    clearTraceRun,
    bumpTraceRefresh,
    openArtifactPreview,
    closeArtifactPreview,
    applyConversationTitle,
  } = useChatStore(
    useShallow((s) => ({
      providers: s.providers,
      selectedProviderId: s.selectedProviderId,
      setSelectedProviderId: s.setSelectedProviderId,
      selectedImageProviderId: s.selectedImageProviderId,
      setSelectedImageProviderId: s.setSelectedImageProviderId,
      selectedVideoProviderId: s.selectedVideoProviderId,
      setSelectedVideoProviderId: s.setSelectedVideoProviderId,
      loadProviders: s.loadProviders,
      setTraceRun: s.setTraceRun,
      clearTraceRun: s.clearTraceRun,
      bumpTraceRefresh: s.bumpTraceRefresh,
      openArtifactPreview: s.openArtifactPreview,
      closeArtifactPreview: s.closeArtifactPreview,
      applyConversationTitle: s.applyConversationTitle,
    })),
  );

  const requestBody = useMemo(
    () => ({
      provider_id: selectedProviderId ?? detail?.provider_id ?? null,
      multimodal_provider_id: selectedImageProviderId ?? null,
      video_provider_id: selectedVideoProviderId ?? null,
      thinking: thinking || null,
      reasoning_effort: null,
    }),
    [
      selectedProviderId,
      selectedImageProviderId,
      selectedVideoProviderId,
      detail?.provider_id,
      thinking,
    ],
  );

  useEffect(() => {
    if (!providers) void loadProviders();
  }, [providers, loadProviders]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatUIMessage>({
        api: id
          ? conversationAgentStreamUrl(id)
          : "/api/chat-server/conversations/missing/agents/run/stream",
        credentials: "include",
        headers: () => chatAuthHeaders(),
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
        fetch: async (request, init) => {
          const response = await fetch(request, init);
          const runId = response.headers.get("x-agent-run-id");
          if (runId && id) setTraceRun(id, runId);
          return response;
        },
      }),
    [id, setTraceRun],
  );

  const {
    messages,
    setMessages,
    sendMessage,
    stop,
    resumeStream,
    addToolOutput,
    status,
  } = useChat<ChatUIMessage>({
    id: id ?? "chat",
    transport,
    resume: false,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onError: (error) => {
      if (/abort|aborted/i.test(error.message)) return;
      toast.error(error.message);
    },
    onData: (dataPart) => {
      if (dataPart.type !== "data-conversation-title") return;
      const title = dataPart.data.title.trim();
      if (!title) return;
      setDetail((current) => (current ? { ...current, title } : current));
      if (id) applyConversationTitle(id, title);
    },
    onFinish: () => {
      bumpTraceRefresh();
      if (!id) return;
      void fetchConversation(id).then((next) => {
        setDetail(next);
        setMessages(next.messages.map(messageToUiMessage));
      });
    },
  });

  const busy = isRunning(status);
  const showThinkingPlaceholder =
    status === "submitted" ||
    (status === "streaming" && isPendingAssistantMessage(messages.at(-1)));
  const documents = useMemo(() => {
    const map = new Map<string, ConversationDocument>();
    for (const document of detail?.documents ?? [])
      map.set(document.id, document);
    return map;
  }, [detail?.documents]);
  const latestTodoCallId = useMemo(
    () => findLatestUpdateTodosCallId(messages),
    [messages],
  );

  useEffect(() => {
    closeArtifactPreview();
  }, [id, closeArtifactPreview]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoading(true);
    clearTraceRun();
    fetchConversation(id)
      .then((next) => {
        if (!active) return;
        setDetail(next);
        setMode(next.agent_mode ?? "normal");
        setMessages(next.messages.map(messageToUiMessage));
      })
      .catch((error) => toast.error(String(error)))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, setMessages, clearTraceRun]);

  useEffect(() => {
    resumedConversationRef.current = null;
  }, [id]);

  // Reconnect to an in-flight run only when the loaded conversation says one is
  // live (active_run_id). For the overwhelmingly common case — opening a
  // finished conversation — this skips the reconnect probe entirely instead of
  // firing a GET .../agents/run/stream that just 204s, and avoids the extra
  // fetchConversation the reconnect path used to trigger.
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
    void resumeStream()
      .then(async () => {
        const next = await fetchConversation(id);
        setDetail(next);
        setMessages(next.messages.map(messageToUiMessage));
      })
      .catch((error) => {
        const message = String(error);
        if (/204|no active|not found/i.test(message)) return;
        toast.error(message);
      });
  }, [
    busy,
    detail?.id,
    detail?.active_run_id,
    id,
    loading,
    resumeStream,
    setMessages,
  ]);

  async function submit(value: PromptInputValue) {
    if (busy || !id) return;
    const documentIds = value.tokens.flatMap((token) => {
      const tokenId = token.meta?.artifactId;
      return typeof tokenId === "string" ? [tokenId] : [];
    });
    const text =
      value.text.trim() ||
      (documentIds.length ? "请阅读并处理我附加的文件。" : "");
    if (!text) return;
    const parts = value.segments.flatMap(
      (segment): ChatUIMessage["parts"][number][] => {
        if (segment.type === "text") {
          return segment.text
            ? [{ type: "text" as const, text: segment.text }]
            : [];
        }
        const documentId = segment.token.meta?.artifactId;
        if (typeof documentId !== "string" || !id) return [];
        return [
          buildUserFilePart({
            conversationId: id,
            documentId,
            filename: segment.token.label,
            mimeType: segment.token.mime ?? "application/octet-stream",
          }),
        ];
      },
    );
    if (!parts.some((part) => part.type === "text")) {
      parts.push({ type: "text", text });
    }
    promptRef.current?.clear();
    try {
      await sendMessage(
        { parts },
        { body: { ...requestBody, document_ids: documentIds } },
      );
    } catch (error) {
      promptRef.current?.setValue(value);
      throw error;
    }
  }

  function onIngestEvent(event: DocumentIngestStreamEvent) {
    if (event.type === "file_progress") {
      promptRef.current?.updateToken(event.client_ref, {
        meta: {
          artifactId: event.artifact_id,
          ingestStatus: event.status,
          ingestProgress: event.progress,
        },
      });
    } else if (event.type === "file_ready") {
      promptRef.current?.updateToken(event.client_ref, {
        meta: {
          artifactId: event.artifact_id,
          ingestStatus: "ready",
          ingestProgress: 100,
        },
      });
    } else if (event.type === "file_failed") {
      promptRef.current?.updateToken(event.client_ref, {
        meta: {
          artifactId: event.artifact_id ?? undefined,
          ingestStatus: "failed",
          ingestError: event.error,
        },
      });
    }
  }

  async function changeMode(nextMode: "normal" | "plan") {
    if (!id || busy || nextMode === mode) return;
    const updated = await updateConversationMode(id, nextMode);
    setMode(updated.agent_mode);
    setDetail((current) => (current ? { ...current, ...updated } : current));
  }

  async function stopRun() {
    const traceRunId = useChatStore.getState().traceRunId;
    const cancelRequest =
      id && traceRunId
        ? cancelConversationAgentRun(id, traceRunId).catch(() => undefined)
        : Promise.resolve(undefined);
    await stop();
    await cancelRequest;
  }

  async function continuePlan(documentId: string) {
    if (!id || busy) return;
    const updated = await updateConversationMode(id, "plan", documentId);
    setMode("plan");
    setDetail((current) => (current ? { ...current, ...updated } : current));
    promptRef.current?.focus();
  }

  async function executePlan(documentId: string) {
    if (!id || busy) return;
    const updated = await updateConversationMode(id, "normal", documentId);
    setMode("normal");
    setDetail((current) => (current ? { ...current, ...updated } : current));
    await sendMessage(
      {
        parts: [
          { type: "text", text: "请按照这个计划开始执行。" },
          { type: "data-plan-execution", data: { document_id: documentId } },
        ] as ChatUIMessage["parts"],
      },
      { body: { ...requestBody, document_ids: [documentId] } },
    );
  }

  async function answerClientTool(
    toolName: string,
    toolCallId: string,
    output: unknown,
  ) {
    await addToolOutput({
      tool: toolName,
      toolCallId,
      output,
      options: { body: requestBody },
    });
  }

  function openArtifact(documentId: string) {
    if (!id) return;
    openArtifactPreview(id, documentId);
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex h-11 shrink-0 items-center justify-center px-4">
        <h1 className="max-w-full truncate text-sm font-medium text-foreground">
          {detail?.title ?? "新对话"}
        </h1>
      </header>

      <Conversation className="min-h-0 flex-1 basis-0">
        <ConversationContent className="mx-auto w-full max-w-4xl gap-6 px-4 py-2">
          {loading && messages.length === 0 ? (
            <ConversationEmptyState
              title="加载中"
              description="正在读取会话..."
            />
          ) : messages.length === 0 ? (
            <ConversationEmptyState
              title="开始对话"
              description="输入你的问题，或粘贴、拖入文件开始。"
            />
          ) : (
            messages.map((message) => (
              <ChatMessageView
                key={message.id}
                message={message}
                conversationId={id ?? ""}
                streaming={busy && message === messages.at(-1)}
                documents={documents}
                latestTodoCallId={latestTodoCallId}
                onOpenArtifact={openArtifact}
                onAnswerClientTool={(toolName, toolCallId, output) => {
                  void answerClientTool(toolName, toolCallId, output).catch(
                    (error) => toast.error(String(error)),
                  );
                }}
                onContinuePlan={(documentId) =>
                  void continuePlan(documentId).catch((error) =>
                    toast.error(String(error)),
                  )
                }
                onExecutePlan={(documentId) =>
                  void executePlan(documentId).catch((error) =>
                    toast.error(String(error)),
                  )
                }
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
          placeholder={
            mode === "plan"
              ? "描述要规划的任务，/ 引用技能，@ 添加上下文"
              : "要求后续变更"
          }
          maxHeight={260}
          accept="image/*,text/plain,text/markdown,application/pdf"
          maxFiles={8}
          maxFileSize={20 * 1024 * 1024}
          onError={(message) => toast.error(message)}
          onStop={() => void stopRun()}
          onFilesAdded={(items) => {
            if (!id) return;
            void streamKnowledgeIngest(
              id,
              items.map(({ token, file }) => ({
                clientRef: token.id,
                file,
              })),
              { onEvent: onIngestEvent },
              { providerId: selectedProviderId },
            ).catch((error) => {
              for (const { token } of items) {
                promptRef.current?.updateToken(token.id, {
                  meta: {
                    ingestStatus: "failed",
                    ingestError: String(error),
                  },
                });
              }
              toast.error(String(error));
            });
          }}
          onSubmit={(value) =>
            void submit(value).catch((error) => toast.error(String(error)))
          }
          footerRender={() => (
            <ChatComposerControls
              providers={providers ?? []}
              selectedProviderId={selectedProviderId}
              onSelectProvider={setSelectedProviderId}
              selectedImageProviderId={selectedImageProviderId}
              onSelectImageProvider={setSelectedImageProviderId}
              selectedVideoProviderId={selectedVideoProviderId}
              onSelectVideoProvider={setSelectedVideoProviderId}
              thinking={thinking}
              onThinkingChange={setThinking}
              mode={mode}
              onModeChange={(next) =>
                void changeMode(next).catch((error) =>
                  toast.error(String(error)),
                )
              }
              disabled={busy}
            />
          )}
        />
      </div>
    </div>
  );
}
