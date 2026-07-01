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
import type { ChatUIMessage } from "../lib/chat-message";
import { buildUserFilePart } from "../lib/file-parts";
import { useChatStore } from "../store/useChatStore";

function messageToUiMessage(message: ApiMessage): ChatUIMessage {
  try {
    const payload = JSON.parse(message.content) as {
      parts?: ChatUIMessage["parts"];
    };
    if (Array.isArray(payload.parts)) {
      return {
        id: message.id,
        role: message.role,
        parts: payload.parts,
      };
    }
  } catch {
    // Plain text messages are not expected for new chat records.
  }
  return {
    id: message.id,
    role: message.role,
    parts: message.content ? [{ type: "text", text: message.content }] : [],
  };
}

function isRunning(
  status: ReturnType<typeof useChat<ChatUIMessage>>["status"],
) {
  return status === "streaming" || status === "submitted";
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
    loadProviders,
    setTraceRun,
    clearTraceRun,
    bumpTraceRefresh,
    openArtifactPreview,
    closeArtifactPreview,
  } = useChatStore(
    useShallow((s) => ({
      providers: s.providers,
      selectedProviderId: s.selectedProviderId,
      setSelectedProviderId: s.setSelectedProviderId,
      loadProviders: s.loadProviders,
      setTraceRun: s.setTraceRun,
      clearTraceRun: s.clearTraceRun,
      bumpTraceRefresh: s.bumpTraceRefresh,
      openArtifactPreview: s.openArtifactPreview,
      closeArtifactPreview: s.closeArtifactPreview,
    })),
  );

  const requestBody = useMemo(
    () => ({
      provider_id: selectedProviderId ?? detail?.provider_id ?? null,
      thinking: thinking || null,
      reasoning_effort: null,
    }),
    [selectedProviderId, detail?.provider_id, thinking],
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
  const documents = useMemo(() => {
    const map = new Map<string, ConversationDocument>();
    for (const document of detail?.documents ?? [])
      map.set(document.id, document);
    return map;
  }, [detail?.documents]);

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

  useEffect(() => {
    if (
      !id ||
      loading ||
      detail?.id !== id ||
      busy ||
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
  }, [busy, detail?.id, id, loading, resumeStream, setMessages]);

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

      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 basis-0 flex-col overflow-hidden px-4 pb-4">
        <Conversation className="min-h-0 flex-1 basis-0">
          <ConversationContent className="gap-6 px-0 py-2">
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
            {status === "submitted" ? (
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

        <div className="shrink-0 pt-2">
          <RichPromptInput
            ref={promptRef}
            className="[&_.prompt-input-footer]:border-t-0 [&_.prompt-input-footer]:bg-transparent"
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
    </div>
  );
}
