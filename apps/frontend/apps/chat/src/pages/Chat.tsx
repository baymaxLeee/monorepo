import { useChat } from "@ai-sdk/react";
import { WorkflowChatTransport } from "@ai-sdk/workflow";
import type { UIMessage } from "ai";
import {
  type Message as ApiMessage,
  type ConversationDetail,
  type ConversationDocument,
  type ConversationDocumentDetail,
  cancelConversationAgent,
  chatAuthHeaders,
  conversationAgentStreamUrl,
  fetchConversation,
  fetchConversationDocument,
  resumeConversationAgentAskUser,
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
  Attachments,
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
  PromptInput,
  PromptInputAttachmentButton,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from "components/ai-chat";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { ChatComposerControls } from "../components/ChatComposerControls";
import { ChatMessageView } from "../components/ChatMessageView";
import { ChatTracePanel } from "../components/ChatTracePanel";
import { useChatStore } from "../store/useChatStore";

function workflowRunStorageKey(conversationId: string): string {
  return `chat.workflowRunId.${conversationId}`;
}

function readStoredWorkflowRunId(conversationId: string): string | null {
  return sessionStorage.getItem(workflowRunStorageKey(conversationId));
}

function clearStoredWorkflowRunId(conversationId: string): void {
  sessionStorage.removeItem(workflowRunStorageKey(conversationId));
}

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
  const [activeWorkflowRunId, setActiveWorkflowRunId] = useState<string | null>(
    id ? readStoredWorkflowRunId(id) : null,
  );
  const [thinking, setThinking] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const [lastWorkflowRunId, setLastWorkflowRunId] = useState<string | null>(
    id ? readStoredWorkflowRunId(id) : null,
  );
  const [traceRefreshKey, setTraceRefreshKey] = useState(0);
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
  const resumedConversationRef = useRef<string | null>(null);
  const pausedByUserRef = useRef(false);

  const requestBody = useMemo(
    () => ({
      provider_id: selectedProviderId ?? detail?.provider_id ?? null,
      document_ids: [] as string[],
      thinking: thinking || null,
      reasoning_effort: null,
    }),
    [selectedProviderId, detail?.provider_id, thinking],
  );

  useEffect(() => {
    if (!providers) void loadProviders();
  }, [providers, loadProviders]);

  function rememberWorkflowRunId(workflowRunId: string): void {
    if (!id) return;
    sessionStorage.setItem(workflowRunStorageKey(id), workflowRunId);
    setActiveWorkflowRunId(workflowRunId);
    setLastWorkflowRunId(workflowRunId);
  }

  function clearWorkflowRunId(): void {
    if (!id) return;
    clearStoredWorkflowRunId(id);
    setActiveWorkflowRunId(null);
  }

  const transport = useMemo(
    () =>
      new WorkflowChatTransport<UIMessage>({
        api: id
          ? conversationAgentStreamUrl(id)
          : "/api/chat-server/conversations/missing/agents/run/stream",
        initialStartIndex: -50,
        maxConsecutiveErrors: 3,
        onChatSendMessage: (response) => {
          const workflowRunId = response.headers.get("x-workflow-run-id");
          if (workflowRunId) rememberWorkflowRunId(workflowRunId);
        },
        onChatEnd: () => {
          clearWorkflowRunId();
        },
        prepareSendMessagesRequest: ({
          messages,
          body,
          headers,
          credentials,
          api,
        }) => ({
          api,
          credentials: credentials ?? "include",
          headers: {
            "Content-Type": "application/json",
            ...chatAuthHeaders(),
            ...(headers ?? {}),
          },
          body: {
            messages,
            ...(body ?? {}),
          },
        }),
        prepareReconnectToStreamRequest: ({ headers, credentials }) => {
          const workflowRunId = id ? readStoredWorkflowRunId(id) : null;
          if (!workflowRunId) {
            throw new Error("no active workflow run");
          }
          return {
            api: `${conversationAgentStreamUrl(id!)}/${encodeURIComponent(workflowRunId)}/stream`,
            credentials: credentials ?? "include",
            headers: {
              ...chatAuthHeaders(),
              ...(headers ?? {}),
            },
          };
        },
      }),
    [id],
  );

  const { messages, setMessages, sendMessage, stop, resumeStream, status } =
    useChat<UIMessage>({
      id: id ?? "chat",
      transport,
      resume: false,
      onError: (error) => {
        if (/abort|aborted/i.test(error.message)) return;
        toast.error(error.message);
      },
      onFinish: () => {
        setTraceRefreshKey((key) => key + 1);
        if (!id) return;
        void fetchConversation(id).then((next) => {
          setDetail(next);
        });
      },
    });

  const busy = isRunning(status);
  const canResume = !busy && activeWorkflowRunId != null;
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
    pausedByUserRef.current = false;
    resumedConversationRef.current = null;
    const storedRunId = readStoredWorkflowRunId(id);
    setActiveWorkflowRunId(storedRunId);
    setLastWorkflowRunId(storedRunId);
    fetchConversation(id)
      .then((next) => {
        if (!active) return;
        setDetail(next);
        setMessages(next.messages.map(messageToUiMessage));
        const lastMessage = next.messages.at(-1);
        if (lastMessage?.role === "assistant" && lastMessage.status === "ok") {
          clearWorkflowRunId();
        }
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
    if (
      !id ||
      loading ||
      busy ||
      pausedByUserRef.current ||
      resumedConversationRef.current === id
    ) {
      return;
    }
    if (!readStoredWorkflowRunId(id)) return;

    resumedConversationRef.current = id;
    void resumeStream().catch((error) => {
      const message = String(error);
      if (/204|no active|not found|no active workflow run/i.test(message)) {
        clearStoredWorkflowRunId(id);
        setActiveWorkflowRunId(null);
        return;
      }
      toast.error(message);
    });
  }, [busy, id, loading, resumeStream]);

  function submit(message: PromptInputMessage) {
    const text = message.text.trim();
    if (!text || busy || canResume) return;
    pausedByUserRef.current = false;
    void sendMessage(
      { text, files: message.files },
      { body: requestBody },
    ).catch((error) => toast.error(String(error)));
  }

  function pauseRun() {
    pausedByUserRef.current = true;
    stop();
  }

  async function answerClientTool(
    _toolName: string,
    toolCallId: string,
    output: unknown,
  ) {
    if (!id) return;
    const workflowRunId = readStoredWorkflowRunId(id);
    if (!workflowRunId) throw new Error("no active workflow run");
    pausedByUserRef.current = false;
    await resumeConversationAgentAskUser(id, workflowRunId, toolCallId, output);
    await resumeStream();
  }

  function latestAssistantMessage(): UIMessage | undefined {
    return [...messages]
      .reverse()
      .find((message) => message.role === "assistant");
  }

  function cancelRun() {
    if (!id) return;
    const workflowRunId = readStoredWorkflowRunId(id);
    if (!workflowRunId) return;
    pausedByUserRef.current = true;
    stop();
    void cancelConversationAgent(id, workflowRunId, latestAssistantMessage())
      .then(() => {
        clearWorkflowRunId();
        return fetchConversation(id);
      })
      .then((next) => {
        setDetail(next);
        setMessages(next.messages.map(messageToUiMessage));
      })
      .catch((error) => toast.error(String(error)));
  }

  function resumeRun() {
    if (!id) return;
    const workflowRunId = readStoredWorkflowRunId(id);
    if (!workflowRunId) return;
    pausedByUserRef.current = false;
    setActiveWorkflowRunId(workflowRunId);
    void resumeStream().catch((error) => toast.error(String(error)));
  }

  function openArtifact(documentId: string) {
    if (!id) return;
    setArtifactOpen(true);
    setArtifactLoading(true);
    fetchConversationDocument(id, documentId)
      .then(setArtifact)
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
            disabled={!lastWorkflowRunId}
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
                />
              ))
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="border-t p-3">
          <PromptInput
            accept="image/*,text/plain,text/markdown,application/pdf"
            multiple
            maxFiles={8}
            onError={(error) => toast.error(error.message)}
            onSubmit={submit}
          >
            <PromptInputHeader>
              <Attachments removable variant="inline" />
            </PromptInputHeader>
            <PromptInputTextarea
              disabled={busy || canResume}
              placeholder="输入消息，粘贴图片/文件，或拖入附件..."
            />
            <PromptInputToolbar>
              <PromptInputTools>
                <PromptInputAttachmentButton disabled={busy || canResume} />
                <ChatComposerControls
                  providers={providers ?? []}
                  selectedProviderId={selectedProviderId}
                  onSelectProvider={setSelectedProviderId}
                  thinking={thinking}
                  onThinkingChange={setThinking}
                  disabled={busy || canResume}
                />
              </PromptInputTools>
              <PromptInputSubmit
                status={status}
                onStop={pauseRun}
                type={canResume ? "button" : undefined}
                onClick={canResume ? resumeRun : undefined}
              >
                {busy ? "暂停" : canResume ? "继续" : "发送"}
              </PromptInputSubmit>
              {busy || canResume ? (
                <Button type="button" variant="outline" onClick={cancelRun}>
                  停止
                </Button>
              ) : null}
            </PromptInputToolbar>
          </PromptInput>
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
                content={artifact.content_md}
                className="h-full rounded-none border-0 shadow-none"
              />
            ) : null}
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
              WorkflowAgent 步骤与工具调用时间线
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-auto">
            {id && lastWorkflowRunId ? (
              <ChatTracePanel
                conversationId={id}
                workflowRunId={lastWorkflowRunId}
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
