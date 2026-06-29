import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import {
  type Message as ApiMessage,
  type ArtifactJob,
  type ConversationDetail,
  type ConversationDocument,
  type ConversationDocumentDetail,
  cancelConversationAgentRun,
  chatAuthHeaders,
  conversationAgentStreamUrl,
  type DocumentIngestStreamEvent,
  fetchConversation,
  fetchConversationArtifactJobs,
  fetchConversationDocument,
  fetchConversationDocumentSource,
  streamKnowledgeIngest,
  updateConversationMode,
} from "api";
import {
  Badge,
  Button,
  Page,
  PageActions,
  PageDescription,
  PageHeader,
  PageHeaderContent,
  PageTitle,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  toast,
} from "components";
import {
  ArtifactPreview,
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
import { ArtifactJobBar } from "../components/ArtifactJobBar";
import { ChatMessageView } from "../components/ChatMessageView";
import { ChatTracePanel } from "../components/ChatTracePanel";
import { MemoryPanel } from "../components/MemoryPanel";
import { useChatStore } from "../store/useChatStore";
import { useMemoryStore } from "../store/useMemoryStore";

const MEMORY_CANDIDATE_POLL_MS = 10_000;

function messageToUiMessage(message: ApiMessage): UIMessage {
  try {
    const payload = JSON.parse(message.content) as {
      parts?: UIMessage["parts"];
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

function isRunning(status: ReturnType<typeof useChat<UIMessage>>["status"]) {
  return status === "streaming" || status === "submitted";
}

export function Chat() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [artifactOpen, setArtifactOpen] = useState(false);
  const [artifact, setArtifact] = useState<ConversationDocumentDetail | null>(
    null,
  );
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [artifactPreviewHtml, setArtifactPreviewHtml] = useState<string | null>(
    null,
  );
  const [thinking, setThinking] = useState(false);
  const [mode, setMode] = useState<"normal" | "plan">("normal");
  const [traceOpen, setTraceOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [lastAgentRunId, setLastAgentRunId] = useState<string | null>(null);
  const [traceRefreshKey, setTraceRefreshKey] = useState(0);
  const [artifactJobs, setArtifactJobs] = useState<ArtifactJob[]>([]);
  const promptRef = useRef<PromptInputRef>(null);
  const {
    providers,
    selectedProviderId,
    setSelectedProviderId,
    loadProviders,
  } = useChatStore(
    useShallow((s) => ({
      providers: s.providers,
      selectedProviderId: s.selectedProviderId,
      setSelectedProviderId: s.setSelectedProviderId,
      loadProviders: s.loadProviders,
    })),
  );

  const { pendingCount, refreshCandidates } = useMemoryStore(
    useShallow((s) => ({
      pendingCount: s.candidates.length,
      refreshCandidates: s.refreshCandidates,
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

  useEffect(() => {
    void refreshCandidates();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshCandidates();
    }, MEMORY_CANDIDATE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [refreshCandidates]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
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
        fetch: async (request, init) => {
          const response = await fetch(request, init);
          const runId = response.headers.get("x-agent-run-id");
          if (runId) setLastAgentRunId(runId);
          return response;
        },
      }),
    [id],
  );

  const { messages, setMessages, sendMessage, stop, addToolOutput, status } =
    useChat<UIMessage>({
      id: id ?? "chat",
      transport,
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
      onError: (error) => {
        if (/abort|aborted/i.test(error.message)) return;
        toast.error(error.message);
      },
      onFinish: () => {
        setTraceRefreshKey((key) => key + 1);
        void refreshCandidates();
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
    if (!id) return;
    let active = true;
    setLoading(true);
    setLastAgentRunId(null);
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
  }, [id, setMessages]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    const refresh = () => {
      void fetchConversationArtifactJobs(id)
        .then((jobs) => {
          if (active) setArtifactJobs(jobs);
        })
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 1_500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [id]);

  async function submit(value: PromptInputValue) {
    if (busy) return;
    const documentIds = value.tokens.flatMap((token) => {
      const id = token.meta?.artifactId;
      return typeof id === "string" ? [id] : [];
    });
    const text =
      value.text.trim() ||
      (documentIds.length ? "请阅读并处理我附加的文件。" : "");
    if (!text) return;
    const parts: Array<Record<string, unknown>> = value.segments.flatMap(
      (segment): Array<Record<string, unknown>> => {
        if (segment.type === "text") {
          return segment.text
            ? [{ type: "text" as const, text: segment.text }]
            : [];
        }
        const documentId = segment.token.meta?.artifactId;
        if (typeof documentId !== "string") return [];
        return [
          {
            type: "data-document-reference" as const,
            data: {
              document_id: documentId,
              filename: segment.token.label,
              mime_type: segment.token.mime ?? "application/octet-stream",
            },
          },
        ];
      },
    );
    if (!parts.some((part) => part.type === "text")) {
      parts.push({ type: "text", text });
    }
    await sendMessage(
      { parts: parts as UIMessage["parts"] },
      { body: { ...requestBody, document_ids: documentIds } },
    );
    promptRef.current?.clear();
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
    await stop();
    if (id && lastAgentRunId) {
      void cancelConversationAgentRun(id, lastAgentRunId).catch(
        () => undefined,
      );
    }
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
        ] as UIMessage["parts"],
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
    setArtifactOpen(true);
    setArtifactLoading(true);
    setArtifactPreviewHtml(null);
    fetchConversationDocument(id, documentId)
      .then(async (document) => {
        setArtifact(document);
        if (document.mime_type === "text/html") {
          const blob = await fetchConversationDocumentSource(id, documentId);
          setArtifactPreviewHtml(await blob.text());
        }
      })
      .catch((error) => toast.error(String(error)))
      .finally(() => setArtifactLoading(false));
  }

  return (
    <Page>
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>{detail?.title ?? "对话"}</PageTitle>
          <PageDescription className="flex items-center gap-2">
            <Badge variant="outline">Vercel AI SDK useChat</Badge>
            {detail?.model ? (
              <Badge variant="secondary" className="font-mono">
                {detail.model}
              </Badge>
            ) : null}
          </PageDescription>
        </PageHeaderContent>
        <PageActions>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="relative"
            onClick={() => setMemoryOpen(true)}
          >
            记忆
            {pendingCount > 0 ? (
              <Badge
                variant="secondary"
                className="ml-1.5 h-4 min-w-4 justify-center px-1 text-[10px]"
              >
                {pendingCount}
              </Badge>
            ) : null}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!lastAgentRunId}
            onClick={() => setTraceOpen(true)}
          >
            执行轨迹
          </Button>
        </PageActions>
      </PageHeader>

      <div className="flex h-[calc(100svh-12rem)] min-h-0 flex-col rounded-lg border bg-card">
        <Conversation>
          <ConversationContent>
            {loading && messages.length === 0 ? (
              <ConversationEmptyState
                title="加载中"
                description="正在读取会话..."
              />
            ) : messages.length === 0 ? (
              <ConversationEmptyState
                title="开始对话"
                description="这页使用 Vercel AI SDK useChat 与 AI Elements 风格组件渲染。"
              />
            ) : (
              messages.map((message) => (
                <ChatMessageView
                  key={message.id}
                  message={message}
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
                className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground"
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

        <div className="border-t p-3">
          <ArtifactJobBar jobs={artifactJobs} />
          <RichPromptInput
            ref={promptRef}
            className="chat-rich-prompt"
            disabled={false}
            loading={busy}
            placeholder={
              mode === "plan"
                ? "描述要规划的任务，/ 引用技能，@ 添加上下文"
                : "输入要求，粘贴图片或拖入文件"
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
                items.map(({ token, file }) => ({ clientRef: token.id, file })),
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

      <Sheet open={artifactOpen} onOpenChange={setArtifactOpen}>
        <SheetContent
          side="right"
          className="w-full min-w-0 gap-0 overflow-hidden sm:max-w-5xl"
        >
          <SheetHeader className="shrink-0 border-b">
            <SheetTitle>{artifact?.title ?? "Artifact"}</SheetTitle>
            <SheetDescription>
              {artifactLoading
                ? "加载中..."
                : artifact
                  ? `${artifact.filename} · ${artifact.mime_type}`
                  : "未选择 artifact"}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden">
            {artifact ? (
              <ArtifactPreview
                title={artifact.title}
                filename={artifact.filename}
                mimeType={artifact.mime_type}
                content={artifactPreviewHtml ?? artifact.content_md}
                showHeader={false}
                className="h-full rounded-none border-0 shadow-none"
              />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={memoryOpen} onOpenChange={setMemoryOpen}>
        <SheetContent
          side="right"
          className="w-full min-w-0 gap-0 overflow-hidden sm:max-w-md"
        >
          <SheetHeader className="shrink-0 border-b">
            <SheetTitle>记忆</SheetTitle>
            <SheetDescription>
              对话后系统会整理候选记忆，确认后才会长期生效。
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-auto">
            <MemoryPanel open={memoryOpen} />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={traceOpen} onOpenChange={setTraceOpen}>
        <SheetContent
          side="right"
          className="w-full min-w-0 gap-0 overflow-hidden sm:max-w-xl"
        >
          <SheetHeader className="shrink-0 border-b">
            <SheetTitle>执行轨迹</SheetTitle>
            <SheetDescription>
              ToolLoopAgent 步骤与工具调用时间线
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-auto">
            {id && lastAgentRunId ? (
              <ChatTracePanel
                conversationId={id}
                runId={lastAgentRunId}
                refreshKey={traceRefreshKey}
              />
            ) : (
              <div className="p-4 text-xs text-muted-foreground">
                暂无可展示的运行。
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </Page>
  );
}
