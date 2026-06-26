import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import {
  type Message as ApiMessage,
  type ConversationDetail,
  type ConversationDocument,
  type ConversationDocumentDetail,
  chatAuthHeaders,
  conversationAgentStreamUrl,
  fetchConversation,
  fetchConversationDocument,
} from "api";
import {
  Badge,
  Page,
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
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ChatMessageView } from "../components/ChatMessageView";

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

  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: id
          ? conversationAgentStreamUrl(id)
          : "/api/chat-server/conversations/missing/agents/run/stream",
        credentials: "include",
        headers: chatAuthHeaders,
        prepareSendMessagesRequest: ({
          messages,
          body,
          headers,
          credentials,
          api,
        }) => ({
          api,
          credentials,
          headers,
          body: {
            messages,
            ...(body ?? {}),
          },
        }),
        prepareReconnectToStreamRequest: ({ headers, credentials, api }) => ({
          api,
          credentials,
          headers,
        }),
      }),
    [id],
  );

  const { messages, setMessages, sendMessage, stop, resumeStream, status } =
    useChat<UIMessage>({
      id: id ?? "chat",
      transport,
      resume: false,
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
      onError: (error) => toast.error(error.message),
      onFinish: () => {
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
    fetchConversation(id)
      .then((next) => {
        if (!active) return;
        setDetail(next);
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
    if (!id || loading || busy) return;
    void resumeStream().catch((error) => {
      const message = String(error);
      if (/204|no active|not found/i.test(message)) return;
      toast.error(message);
    });
  }, [busy, id, loading, resumeStream]);

  function submit(message: PromptInputMessage) {
    const text = message.text.trim();
    if (!text || busy) return;
    void sendMessage(
      { text, files: message.files },
      {
        body: {
          provider_id: detail?.provider_id ?? null,
          document_ids: [],
          thinking: null,
          reasoning_effort: null,
        },
      },
    ).catch((error) => toast.error(String(error)));
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
              disabled={busy}
              placeholder="输入消息，粘贴图片/文件，或拖入附件..."
            />
            <PromptInputToolbar>
              <PromptInputTools>
                <PromptInputAttachmentButton disabled={busy} />
              </PromptInputTools>
              <PromptInputSubmit status={status} onStop={stop}>
                {busy ? "停止" : "发送"}
              </PromptInputSubmit>
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
    </Page>
  );
}
