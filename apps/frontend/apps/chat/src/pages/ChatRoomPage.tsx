import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  getToolName,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import {
  type ConversationDetail,
  type ConversationDocument,
  type ConversationDocumentDetail,
  cancelConversationAgent,
  chatAuthHeaders,
  conversationAgentStreamUrl,
  type DocumentIngestStreamEvent,
  fetchConversation,
  fetchKnowledgeDocument,
  fetchKnowledgeDocumentSource,
  isMediaConversationDocument,
  type Message,
  type ModelProvider,
  type ReasoningEffort,
  streamKnowledgeIngest,
  toConversationDocument,
  updateKnowledgeDocument,
} from "api";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
  Page,
  PageDescription,
  PageHeader,
  PageHeaderContent,
  PageTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Switch,
  toast,
} from "components";
import { MarkdownEditor } from "components/markdown-editor";
import {
  PromptInput,
  type PromptInputRef,
  type PromptInputToken,
  type PromptInputValue,
} from "components/prompt-input";
import { PromptMessageContent } from "components/prompt-message-content";
import {
  CheckIcon,
  DownloadIcon,
  FileTextIcon,
  SettingsIcon,
  XIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  extractSlotIds,
  parseSlots,
  serializeSlots,
  tokenIdByArtifactId,
} from "shared";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import { useShallow } from "zustand/react/shallow";
import { useChatStore } from "../store/useChatStore";

function messageToUiMessage(message: Message): UIMessage {
  return {
    id: message.id,
    role: message.role,
    parts: message.content ? [{ type: "text", text: message.content }] : [],
  };
}

function hasPendingHitl(messages: UIMessage[]): boolean {
  return messages.some((message) =>
    message.parts.some((part) => {
      if (!isToolUIPart(part)) return false;
      return (
        part.state === "approval-requested" ||
        part.state === "input-available" ||
        part.state === "input-streaming"
      );
    }),
  );
}

function mergeUiMessagesFromDb(
  current: UIMessage[],
  dbMessages: Message[],
): UIMessage[] {
  if (hasPendingHitl(current)) return current;
  if (current.length > dbMessages.length) return current;
  return dbMessages.map(messageToUiMessage);
}

const REASONING_OPTIONS: { value: ReasoningEffort; label: string }[] = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];
const STORAGE_KEY = "chat.reasoning-prefs.v1";
const MAX_ATTACHMENTS_PER_MESSAGE = 5;
const MULTIMODAL_PROVIDER_HINT_RE =
  /doubao|豆包|seed|vision|image|multimodal|vl/i;
const MULTIMODAL_PROVIDER_EXCLUDE_RE =
  /seedance|seededit|seedream|i2v|t2v|video-?gen/i;
const MULTIMODAL_PROVIDER_PREFER_RE = /vision|vl|豆包/i;
const MULTIMODAL_PROVIDER_AUTO = "__auto";
const MULTIMODAL_PROVIDER_NONE = "__none";

type ReasoningPrefs = { thinking: boolean; effort: ReasoningEffort };
const DEFAULT_PREFS: ReasoningPrefs = { thinking: false, effort: "medium" };

function loadPrefs(): ReasoningPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<ReasoningPrefs>;
    return {
      thinking: Boolean(parsed.thinking),
      effort:
        parsed.effort === "low" || parsed.effort === "high"
          ? parsed.effort
          : "medium",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(prefs: ReasoningPrefs) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage may be unavailable (private browsing); silently ignore.
  }
}

function buildPromptContent(value: PromptInputValue): string {
  const serialized = serializeSlots(
    { segments: value.segments },
    tokenIdByArtifactId(value.tokens),
  );
  return serialized.trim() || "请阅读附件并总结要点";
}

function mergeDocumentsById(
  current: ConversationDocument[],
  incoming: ConversationDocument[],
) {
  const seen = new Set(current.map((document) => document.id));
  return [
    ...current,
    ...incoming.filter((document) => {
      if (seen.has(document.id)) return false;
      seen.add(document.id);
      return true;
    }),
  ];
}

function extractHtmlPreview(content: string): string | null {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:html|htm)\s*\n([\s\S]*?)\n```$/i);
  if (fenced?.[1]?.trim()) return fenced[1].trim();
  const looseFenced = trimmed.match(/```(?:html|htm)\s*\n([\s\S]*?)\n```/i);
  if (looseFenced?.[1]?.trim()) return looseFenced[1].trim();
  const lowered = trimmed.toLowerCase();
  if (lowered.startsWith("<!doctype html") || lowered.startsWith("<html")) {
    return trimmed;
  }
  const embeddedHtml = trimmed.match(
    /(?:<!doctype html\s*)?<html[\s\S]*<\/html>/i,
  );
  if (embeddedHtml?.[0]?.trim()) return embeddedHtml[0].trim();
  return null;
}

type DocumentPreviewMode = "markdown" | "html" | "image" | "video" | "audio";

function previewModeFromMime(mime: string): DocumentPreviewMode | null {
  const lowered = mime.toLowerCase();
  if (lowered.startsWith("image/")) return "image";
  if (lowered.startsWith("video/")) return "video";
  if (lowered.startsWith("audio/")) return "audio";
  return null;
}

function resolveDocumentPreviewMode(
  document: ConversationDocumentDetail,
): DocumentPreviewMode {
  const mime = (
    document.source_mime_type ||
    document.mime_type ||
    ""
  ).toLowerCase();
  const mediaMode = previewModeFromMime(mime);
  if (mediaMode) return mediaMode;
  if (extractHtmlPreview(document.content_md)) return "html";
  return "markdown";
}

function downloadMarkdown(document: ConversationDocumentDetail) {
  const blob = new Blob([document.content_md], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = document.filename || `${document.title}.md`;
  link.click();
  URL.revokeObjectURL(url);
}

function inferMultimodalProvider(
  providers: ModelProvider[],
): ModelProvider | null {
  const candidates = providers.filter((p) => {
    const blob = `${p.name} ${p.model} ${p.base_url}`;
    if (MULTIMODAL_PROVIDER_EXCLUDE_RE.test(blob)) return false;
    return MULTIMODAL_PROVIDER_HINT_RE.test(blob);
  });
  return (
    candidates.find((p) =>
      MULTIMODAL_PROVIDER_PREFER_RE.test(`${p.name} ${p.model}`),
    ) ??
    candidates[0] ??
    null
  );
}

function stableKey(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

export function ChatRoomPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<ReasoningPrefs>(() => loadPrefs());
  const [attachmentCount, setAttachmentCount] = useState(0);
  const [ingestInFlight, setIngestInFlight] = useState(false);
  const [documentOpen, setDocumentOpen] = useState(false);
  const [selectedDocument, setSelectedDocument] =
    useState<ConversationDocumentDetail | null>(null);
  const [documentDraft, setDocumentDraft] = useState("");
  const [documentPreviewMode, setDocumentPreviewMode] =
    useState<DocumentPreviewMode>("markdown");
  const [htmlPreviewUrl, setHtmlPreviewUrl] = useState<string | null>(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);
  const [loadingDocument, setLoadingDocument] = useState(false);
  const [savingDocument, setSavingDocument] = useState(false);
  const [selectedMultimodalProviderId, setSelectedMultimodalProviderId] =
    useState<string>(MULTIMODAL_PROVIDER_AUTO);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const promptInputRef = useRef<PromptInputRef | null>(null);
  const resumedConversationRef = useRef<string | null>(null);
  const ingestQueueRef = useRef<Array<{ clientRef: string; file: File }>>([]);
  const ingestTimerRef = useRef<number | null>(null);
  const ingestAbortRef = useRef<AbortController | null>(null);
  const openDocumentRequestRef = useRef(0);
  const loadSeqRef = useRef(0);

  const {
    providers,
    providersError,
    isLoadingProviders,
    selectedProviderId,
    setSelectedProviderId,
  } = useChatStore(
    useShallow((state) => ({
      providers: state.providers,
      providersError: state.providersError,
      isLoadingProviders: state.isLoadingProviders,
      selectedProviderId: state.selectedProviderId,
      setSelectedProviderId: state.setSelectedProviderId,
    })),
  );

  const enabledProviders: ModelProvider[] =
    providers?.filter((p) => p.is_enabled) ?? [];
  const hasProviders = enabledProviders.length > 0;
  const effectiveProviderId = selectedProviderId ?? detail?.provider_id ?? null;
  const effectiveProvider =
    enabledProviders.find((p) => p.id === effectiveProviderId) ??
    enabledProviders.find((p) => p.is_default) ??
    enabledProviders[0] ??
    null;
  const inferredMultimodalProvider = inferMultimodalProvider(enabledProviders);
  const effectiveMultimodalProvider =
    selectedMultimodalProviderId === MULTIMODAL_PROVIDER_NONE
      ? null
      : selectedMultimodalProviderId === MULTIMODAL_PROVIDER_AUTO
        ? inferredMultimodalProvider
        : (enabledProviders.find(
            (p) => p.id === selectedMultimodalProviderId,
          ) ?? null);

  const chatTransport = useMemo(
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

  const {
    messages: uiMessages,
    setMessages: setUiMessages,
    sendMessage,
    addToolApprovalResponse,
    addToolOutput,
    stop,
    resumeStream,
    status: chatStatus,
  } = useChat<UIMessage>({
    id: id ?? "chat",
    transport: chatTransport,
    resume: false,
    experimental_throttle: 50,
    sendAutomaticallyWhen: ({ messages }) =>
      lastAssistantMessageIsCompleteWithApprovalResponses({ messages }) ||
      lastAssistantMessageIsCompleteWithToolCalls({ messages }),
    onError: (err) => toast.error(err.message),
    onFinish: ({ messages }) => {
      if (!id) return;
      const preserveUi = hasPendingHitl(messages);
      void fetchConversation(id).then((next) => {
        setDetail(next);
        if (preserveUi) return;
        setUiMessages(next.messages.map(messageToUiMessage));
      });
    },
  });
  const agentBusy =
    chatStatus === "streaming" || chatStatus === "submitted";

  const agentRequestBody = useCallback(
    (displayContent?: string) => ({
      provider_id: effectiveProvider?.id ?? null,
      multimodal_provider_id: effectiveMultimodalProvider?.id ?? null,
      document_ids: displayContent ? extractSlotIds(displayContent) : [],
      thinking: prefs.thinking ? true : null,
      reasoning_effort: prefs.thinking ? prefs.effort : null,
    }),
    [
      effectiveMultimodalProvider?.id,
      effectiveProvider?.id,
      prefs.effort,
      prefs.thinking,
    ],
  );

  const documents = detail?.documents ?? [];
  const documentMap = useMemo(() => {
    const map = new Map<string, ConversationDocument>();
    for (const document of documents) map.set(document.id, document);
    return map;
  }, [documents]);

  useEffect(() => {
    if (
      !documentOpen ||
      documentPreviewMode !== "html" ||
      loadingDocument ||
      !selectedDocument
    ) {
      setHtmlPreviewUrl(null);
      return;
    }
    const html = extractHtmlPreview(selectedDocument.content_md);
    if (!html) {
      setHtmlPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    setHtmlPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [
    documentOpen,
    documentPreviewMode,
    loadingDocument,
    selectedDocument?.id,
    selectedDocument?.content_md,
  ]);

  useEffect(() => {
    if (!documentOpen || !mediaPreviewUrl) return;
    return () => URL.revokeObjectURL(mediaPreviewUrl);
  }, [documentOpen, mediaPreviewUrl]);

  useEffect(() => {
    if (!id || !documentOpen || !selectedDocument || loadingDocument) return;
    if (documentPreviewMode !== "markdown") return;
    if (htmlPreviewUrl) return;
    if (documentDraft === selectedDocument.content_md) return;

    setSavingDocument(true);
    const timer = window.setTimeout(() => {
      void updateKnowledgeDocument(id, selectedDocument.id, {
        content_md: documentDraft,
      })
        .then((next) => {
          setSelectedDocument(next);
          setDetail((prev) =>
            prev
              ? {
                  ...prev,
                  documents: prev.documents.map((document) =>
                    document.id === next.id ? next : document,
                  ),
                }
              : prev,
          );
        })
        .catch((e) => {
          toast.error(String(e));
        })
        .finally(() => setSavingDocument(false));
    }, 800);

    return () => {
      window.clearTimeout(timer);
      setSavingDocument(false);
    };
  }, [
    documentDraft,
    documentOpen,
    documentPreviewMode,
    htmlPreviewUrl,
    id,
    loadingDocument,
    selectedDocument,
  ]);

  const load = useCallback(async () => {
    if (!id) return;
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await fetchConversation(id);
      if (seq !== loadSeqRef.current) return;
      setDetail(next);
      setUiMessages((current) => mergeUiMessagesFromDb(current, next.messages));
    } catch (e) {
      if (seq !== loadSeqRef.current) return;
      setError(String(e));
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [id, setUiMessages]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    resumedConversationRef.current = null;
  }, [id]);

  useEffect(() => {
    if (!id || loading || agentBusy || resumedConversationRef.current === id) {
      return;
    }
    resumedConversationRef.current = id;
    void resumeStream()
      .then(async () => {
        const next = await fetchConversation(id);
        setDetail(next);
        setUiMessages((current) => mergeUiMessagesFromDb(current, next.messages));
      })
      .catch((e) => {
        const message = String(e);
        if (/204|no active|not found/i.test(message)) return;
        toast.error(message);
      });
  }, [agentBusy, id, loading, resumeStream, setUiMessages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, []);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [uiMessages]);

  const updatePrefs = useCallback((patch: Partial<ReasoningPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      savePrefs(next);
      return next;
    });
  }, []);

  const applyIngestEvent = useCallback(
    (event: DocumentIngestStreamEvent) => {
      const api = promptInputRef.current;
      if (!api) return;

      const patchToken = (
        clientRef: string,
        patch: Partial<PromptInputToken>,
      ) => {
        api.updateToken(clientRef, patch);
      };

      switch (event.type) {
        case "file_started":
          patchToken(event.client_ref, {
            meta: {
              ingestStatus: "storing",
              ingestProgress: 5,
            },
          });
          break;
        case "file_progress":
          patchToken(event.client_ref, {
            meta: {
              artifactId: event.artifact_id,
              ingestStatus: event.status,
              ingestProgress: event.progress,
            },
          });
          break;
        case "file_ready":
          patchToken(event.client_ref, {
            id: event.artifact_id,
            label: event.document.title || event.document.filename,
            meta: {
              clientRef: event.client_ref,
              artifactId: event.artifact_id,
              ingestStatus: "ready",
              ingestProgress: 100,
            },
          });
          setDetail((prev) =>
            prev && id
              ? {
                  ...prev,
                  documents: mergeDocumentsById(prev.documents, [
                    toConversationDocument(
                      event.document as unknown as Record<string, unknown>,
                      id,
                    ),
                  ]),
                }
              : prev,
          );
          break;
        case "file_failed":
          patchToken(event.client_ref, {
            meta: {
              ingestStatus: "failed",
              ingestProgress: 0,
              ingestError: event.error,
            },
          });
          toast.error(event.error);
          break;
        default:
          break;
      }
    },
    [id],
  );

  const flushIngestQueue = useCallback(async () => {
    if (!id || ingestQueueRef.current.length === 0) return;
    const batch = ingestQueueRef.current.splice(0, MAX_ATTACHMENTS_PER_MESSAGE);
    ingestAbortRef.current?.abort();
    const controller = new AbortController();
    ingestAbortRef.current = controller;
    setIngestInFlight(true);
    try {
      await streamKnowledgeIngest(
        id,
        batch.map((item) => ({
          clientRef: item.clientRef,
          file: item.file,
        })),
        {
          signal: controller.signal,
          onEvent: applyIngestEvent,
        },
        {
          providerId: effectiveMultimodalProvider?.id ?? null,
        },
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      toast.error(String(error));
    } finally {
      setIngestInFlight(false);
    }
  }, [applyIngestEvent, effectiveMultimodalProvider?.id, id]);

  const queueIngestFiles = useCallback(
    (items: Array<{ token: PromptInputToken; file: File }>) => {
      if (!id) return;
      if (items.length === 0) return;
      for (const item of items) {
        ingestQueueRef.current.push({
          clientRef: item.token.id,
          file: item.file,
        });
      }
      if (ingestTimerRef.current !== null) {
        window.clearTimeout(ingestTimerRef.current);
      }
      ingestTimerRef.current = window.setTimeout(() => {
        ingestTimerRef.current = null;
        void flushIngestQueue();
      }, 150);
    },
    [flushIngestQueue, id],
  );

  async function openDocument(documentId: string) {
    if (!id) return;
    const requestId = ++openDocumentRequestRef.current;

    setDocumentOpen(true);
    setLoadingDocument(true);
    setSelectedDocument(null);
    setDocumentDraft("");
    setDocumentPreviewMode("markdown");
    setMediaPreviewUrl(null);
    setHtmlPreviewUrl(null);

    const cached = documentMap.get(documentId);
    const cachedMediaMode =
      cached && isMediaConversationDocument(cached)
        ? resolveDocumentPreviewMode({ ...cached, content_md: "" })
        : null;

    try {
      if (cached && cachedMediaMode) {
        setSelectedDocument({ ...cached, content_md: "" });
        setDocumentPreviewMode(cachedMediaMode);
        const blob = await fetchKnowledgeDocumentSource(id, documentId);
        if (requestId !== openDocumentRequestRef.current) return;
        setMediaPreviewUrl(URL.createObjectURL(blob));
        return;
      }

      if (!cached) {
        try {
          const blob = await fetchKnowledgeDocumentSource(id, documentId);
          const mediaMode = previewModeFromMime(blob.type);
          if (mediaMode) {
            if (requestId !== openDocumentRequestRef.current) return;
            setSelectedDocument({
              id: documentId,
              conversation_id: id,
              kind: "source",
              title: documentId,
              filename: documentId,
              mime_type: blob.type,
              source_mime_type: blob.type,
              source_size: blob.size,
              content_md: "",
              created_at: "",
              updated_at: "",
            });
            setDocumentPreviewMode(mediaMode);
            setMediaPreviewUrl(URL.createObjectURL(blob));
            return;
          }
        } catch {
          // Not a binary source object — load markdown/html metadata below.
        }
      }

      const next = await fetchKnowledgeDocument(id, documentId);
      if (requestId !== openDocumentRequestRef.current) return;

      const mode = resolveDocumentPreviewMode(next);
      setSelectedDocument(next);
      setDocumentDraft(next.content_md);
      setDocumentPreviewMode(mode);

      if (mode === "image" || mode === "video" || mode === "audio") {
        const blob = await fetchKnowledgeDocumentSource(id, documentId);
        if (requestId !== openDocumentRequestRef.current) return;
        setMediaPreviewUrl(URL.createObjectURL(blob));
      }
    } catch (e) {
      if (requestId !== openDocumentRequestRef.current) return;
      toast.error(String(e));
      setDocumentOpen(false);
    } finally {
      if (requestId === openDocumentRequestRef.current) {
        setLoadingDocument(false);
      }
    }
  }

  const stopAgentRun = useCallback(() => {
    if (!id) return;
    stop();
    void cancelConversationAgent(id).catch(() => undefined);
  }, [id, stop]);

  const approveToolCall = useCallback(
    async (approvalId: string, approved: boolean, reason?: string) => {
      if (!id) return;
      try {
        await addToolApprovalResponse({
          id: approvalId,
          approved,
          reason,
          options: {
            body: agentRequestBody(),
          },
        });
      } catch (e) {
        toast.error(String(e));
      }
    },
    [addToolApprovalResponse, agentRequestBody, id],
  );

  const answerClientTool = useCallback(
    async (toolName: string, toolCallId: string, output: unknown) => {
      if (!id) return;
      try {
        await addToolOutput({
          tool: toolName,
          toolCallId,
          output,
          options: {
            body: agentRequestBody(),
          },
        } as Parameters<typeof addToolOutput>[0]);
      } catch (e) {
        toast.error(String(e));
      }
    },
    [addToolOutput, agentRequestBody, id],
  );

  async function sendPrompt(value: PromptInputValue) {
    if (!id || agentBusy) return;

    const displayContent = buildPromptContent(value);
    if (!displayContent && value.tokens.length === 0) return;

    stop();
    try {
      promptInputRef.current?.clear();
      setAttachmentCount(0);

      void sendMessage(
        { text: displayContent },
        {
          body: agentRequestBody(displayContent),
        },
      ).catch((e) => toast.error(String(e)));
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: "smooth",
        });
      });
    } catch (e) {
      toast.error(String(e));
    }
  }

  return (
    <Page>
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>
            {detail?.title ?? (loading ? "加载中..." : "对话")}
          </PageTitle>
          <PageDescription className="flex items-center gap-2">
            {effectiveProvider ? (
              <Badge variant="outline" className="font-mono text-xs">
                {effectiveProvider.name} · {effectiveProvider.model}
              </Badge>
            ) : detail?.model ? (
              <Badge variant="outline" className="font-mono text-xs">
                {detail.model}
              </Badge>
            ) : null}
            {effectiveMultimodalProvider ? (
              <Badge variant="secondary" className="font-mono text-xs">
                多模态 · {effectiveMultimodalProvider.name}
              </Badge>
            ) : null}
            <span>
              共 {uiMessages.length} 条消息，按 Cmd/Ctrl + Enter 也可发送
            </span>
          </PageDescription>
        </PageHeaderContent>
      </PageHeader>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>会话加载失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {providersError ? (
        <Alert variant="destructive">
          <AlertTitle>无法加载模型列表</AlertTitle>
          <AlertDescription>{providersError}</AlertDescription>
        </Alert>
      ) : !isLoadingProviders && !hasProviders ? (
        <Alert>
          <SettingsIcon aria-hidden="true" className="size-4" />
          <AlertTitle>尚未配置模型 Provider</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>请先到</span>
            <Button asChild size="sm" variant="outline">
              <Link to="/platform/admin/providers">Admin {"->"} 模型管理</Link>
            </Button>
            <span>配置至少一个 OpenAI 兼容端点，然后再发送消息。</span>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex h-[calc(100svh-12rem)] flex-col gap-3 rounded-lg border bg-card">
        <div
          ref={scrollRef}
          className="flex-1 space-y-4 overflow-y-auto p-4"
          aria-live="polite"
        >
          {loading && uiMessages.length === 0 ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-2/3" />
              <Skeleton className="ml-auto h-16 w-3/4" />
              <Skeleton className="h-12 w-1/2" />
            </div>
          ) : uiMessages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              开始你的第一条消息吧。
            </p>
          ) : (
            uiMessages.map((m, index) => (
              <MessageBubble
                key={m.id}
                message={m}
                documents={documentMap}
                onOpenDocument={(documentId) => void openDocument(documentId)}
                onApproveTool={(approvalId, approved, reason) =>
                  void approveToolCall(approvalId, approved, reason)
                }
                onAnswerClientTool={(toolName, toolCallId, output) =>
                  void answerClientTool(toolName, toolCallId, output)
                }
                streaming={
                  (chatStatus === "streaming" || chatStatus === "submitted") &&
                  m.role === "assistant" &&
                  index === uiMessages.length - 1
                }
              />
            ))
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-3 py-2 text-sm">
          <div className="flex items-center gap-2">
            <Label htmlFor="chat-provider" className="text-muted-foreground">
              模型
            </Label>
            <Select
              value={effectiveProvider?.id ?? ""}
              onValueChange={(value) => setSelectedProviderId(value)}
              disabled={!hasProviders || agentBusy}
            >
              <SelectTrigger id="chat-provider" className="h-8 w-56">
                <SelectValue
                  placeholder={
                    isLoadingProviders
                      ? "加载中..."
                      : hasProviders
                        ? "选择 Provider"
                        : "未配置"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {enabledProviders.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="flex items-center gap-2">
                      <span>{p.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {p.model}
                      </span>
                      {p.is_default && (
                        <Badge variant="outline" className="h-4 text-[10px]">
                          默认
                        </Badge>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label
              htmlFor="chat-multimodal-provider"
              className="text-muted-foreground"
            >
              多模态
            </Label>
            <Select
              value={selectedMultimodalProviderId}
              onValueChange={setSelectedMultimodalProviderId}
              disabled={!hasProviders || agentBusy}
            >
              <SelectTrigger id="chat-multimodal-provider" className="h-8 w-56">
                <SelectValue placeholder="选择多模态 Provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={MULTIMODAL_PROVIDER_AUTO}>
                  自动选择
                </SelectItem>
                <SelectItem value={MULTIMODAL_PROVIDER_NONE}>不使用</SelectItem>
                {enabledProviders.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="flex items-center gap-2">
                      <span>{p.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {p.model}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="chat-thinking"
              checked={prefs.thinking}
              onCheckedChange={(checked) => updatePrefs({ thinking: checked })}
              disabled={agentBusy}
              aria-label="启用 thinking 推理"
            />
            <Label htmlFor="chat-thinking" className="cursor-pointer">
              开启 thinking
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="chat-effort" className="text-muted-foreground">
              推理算力
            </Label>
            <Select
              value={prefs.effort}
              onValueChange={(value) =>
                updatePrefs({ effort: value as ReasoningEffort })
              }
              disabled={!prefs.thinking || agentBusy}
            >
              <SelectTrigger id="chat-effort" className="h-8 w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASONING_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            {agentBusy ? (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="h-7"
                onClick={stopAgentRun}
              >
                停止生成
              </Button>
            ) : null}
            附件会在输入时并行导入，全部就绪后才能发送。
          </span>
        </div>

        <div className="border-t p-3">
          <PromptInput
            ref={promptInputRef}
            placeholder="发送消息，或拖入文件让 MarkItDown 转成可编辑 Markdown..."
            disabled={agentBusy || !hasProviders}
            loading={agentBusy || ingestInFlight}
            onChange={(value) => setAttachmentCount(value.tokens.length)}
            onFilesAdded={queueIngestFiles}
            footerRender={() => {
              return (
                <>
                  {ingestInFlight ? (
                    <Badge variant="outline" className="gap-1 text-xs">
                      导入中...
                    </Badge>
                  ) : null}
                  {attachmentCount > 0 ? (
                    <Badge variant="secondary" className="gap-1 text-xs">
                      <FileTextIcon className="size-3" />
                      附件 x{" "}
                      {Math.min(attachmentCount, MAX_ATTACHMENTS_PER_MESSAGE)}
                    </Badge>
                  ) : null}
                </>
              );
            }}
            onSubmit={(value) => {
              void sendPrompt(value);
            }}
          />
        </div>
      </div>

      <Sheet open={documentOpen} onOpenChange={setDocumentOpen}>
        <SheetContent
          side="right"
          className="w-full min-w-0 gap-0 overflow-hidden sm:max-w-5xl"
        >
          <SheetHeader className="shrink-0 border-b">
            <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
              <div>
                <SheetTitle>{selectedDocument?.title ?? "文档预览"}</SheetTitle>
                <SheetDescription>
                  {selectedDocument
                    ? `${selectedDocument.kind === "artifact" ? "Agent 产物" : "上传文件"} · ${selectedDocument.filename}${savingDocument ? " · 自动保存中" : ""}`
                    : "加载中..."}
                </SheetDescription>
              </div>
              {selectedDocument && documentPreviewMode === "markdown" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => downloadMarkdown(selectedDocument)}
                >
                  <DownloadIcon className="mr-1 size-3" />
                  下载
                </Button>
              ) : null}
            </div>
          </SheetHeader>
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            {loadingDocument ? (
              <Skeleton className="h-96 w-full" />
            ) : selectedDocument ? (
              documentPreviewMode === "image" && mediaPreviewUrl ? (
                <div className="flex h-full min-h-0 items-center justify-center">
                  <img
                    key={selectedDocument.id}
                    src={mediaPreviewUrl}
                    alt={selectedDocument.title}
                    className="max-h-full max-w-full rounded-md border object-contain"
                  />
                </div>
              ) : documentPreviewMode === "video" && mediaPreviewUrl ? (
                // biome-ignore lint/a11y/useMediaCaption: Uploaded preview media may not include captions.
                <video
                  key={selectedDocument.id}
                  src={mediaPreviewUrl}
                  controls
                  className="max-h-full w-full rounded-md border bg-black"
                />
              ) : documentPreviewMode === "audio" && mediaPreviewUrl ? (
                <div className="flex h-full items-center justify-center">
                  {/* biome-ignore lint/a11y/useMediaCaption: Uploaded preview media may not include captions. */}
                  <audio
                    key={selectedDocument.id}
                    src={mediaPreviewUrl}
                    controls
                    className="w-full max-w-lg"
                  />
                </div>
              ) : documentPreviewMode === "html" && htmlPreviewUrl ? (
                <div className="flex h-full min-h-0 min-w-0 flex-col gap-2">
                  <iframe
                    key={selectedDocument.id}
                    title={selectedDocument.title}
                    src={htmlPreviewUrl}
                    sandbox="allow-scripts"
                    className="min-h-0 w-full flex-1  bg-white"
                  />
                </div>
              ) : (
                <div className="h-full min-h-0 min-w-0 w-full overflow-hidden">
                  <MarkdownEditor
                    key={selectedDocument.id}
                    value={documentDraft}
                    contentType="markdown"
                    editable={documentPreviewMode === "markdown"}
                    className="h-full min-h-0 w-full min-w-0 max-w-full rounded-md border"
                    onChange={setDocumentDraft}
                  />
                </div>
              )
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </Page>
  );
}

const streamdownClassName =
  "prose prose-sm max-w-none break-words leading-relaxed dark:prose-invert prose-p:my-1.5 prose-pre:my-2 prose-pre:rounded-md prose-code:before:content-none prose-code:after:content-none";

function SlotTextContent({
  content,
  documents,
  isAnimating = false,
  onOpenDocument,
}: {
  content: string;
  documents: Map<string, ConversationDocument>;
  isAnimating?: boolean;
  onOpenDocument: (documentId: string) => void;
}) {
  const segments = parseSlots(content);
  const hasSlots = segments.some((segment) => segment.type === "slot");

  if (!hasSlots) {
    if (!content.trim()) return null;
    return (
      <Streamdown isAnimating={isAnimating} className={streamdownClassName}>
        {content}
      </Streamdown>
    );
  }

  return (
    <div className="space-y-2">
      {segments.map((segment) =>
        segment.type === "slot" ? (
          <DocumentCard
            key={`slot-${segment.documentId}-${stableKey(JSON.stringify(segment))}`}
            document={documents.get(segment.documentId)}
            documentId={segment.documentId}
            onOpen={() => onOpenDocument(segment.documentId)}
          />
        ) : segment.text.trim() ? (
          <Streamdown
            key={`text-${stableKey(segment.text)}`}
            isAnimating={isAnimating}
            className={streamdownClassName}
          >
            {segment.text}
          </Streamdown>
        ) : null,
      )}
    </div>
  );
}

const MessageBubble = memo(function MessageBubble({
  message,
  documents,
  onOpenDocument,
  onApproveTool,
  onAnswerClientTool,
  streaming,
}: {
  message: UIMessage;
  documents: Map<string, ConversationDocument>;
  onOpenDocument: (documentId: string) => void;
  onApproveTool: (
    approvalId: string,
    approved: boolean,
    reason?: string,
  ) => void;
  onAnswerClientTool: (
    toolName: string,
    toolCallId: string,
    output: unknown,
  ) => void;
  streaming: boolean;
}) {
  const isUser = message.role === "user";
  const isStreaming = streaming && message.role === "assistant";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground"
        }`}
      >
        <div className="mb-1 flex items-center gap-2 text-xs opacity-70">
          <span>{isUser ? "你" : "助手"}</span>
          {isStreaming ? (
            <Badge variant="secondary" className="h-4 px-1 text-[10px]">
              输出中...
            </Badge>
          ) : null}
        </div>
        {message.parts.length > 0 ? (
          <div className="space-y-3">
            {message.parts.map((part, partIndex) => (
              <MessagePartView
                key={
                  isToolUIPart(part)
                    ? `${message.id}-${part.toolCallId}`
                    : `${message.id}-${part.type}-${partIndex}`
                }
                part={part}
                isUser={isUser}
                isAnimating={isStreaming}
                documents={documents}
                onOpenDocument={onOpenDocument}
                onApproveTool={onApproveTool}
                onAnswerClientTool={onAnswerClientTool}
              />
            ))}
          </div>
        ) : (
          <div className="text-muted-foreground">...</div>
        )}
      </div>
    </div>
  );
});

function MessagePartView({
  part,
  isUser,
  isAnimating,
  documents,
  onOpenDocument,
  onApproveTool,
  onAnswerClientTool,
}: {
  part: UIMessage["parts"][number];
  isUser: boolean;
  isAnimating: boolean;
  documents: Map<string, ConversationDocument>;
  onOpenDocument: (documentId: string) => void;
  onApproveTool: (
    approvalId: string,
    approved: boolean,
    reason?: string,
  ) => void;
  onAnswerClientTool: (
    toolName: string,
    toolCallId: string,
    output: unknown,
  ) => void;
}) {
  if (part.type === "text") {
    return isUser ? (
      <PromptMessageContent
        content={part.text}
        documents={documents}
        onOpenDocument={onOpenDocument}
      />
    ) : (
      <SlotTextContent
        content={part.text}
        documents={documents}
        isAnimating={isAnimating}
        onOpenDocument={onOpenDocument}
      />
    );
  }

  if (part.type === "reasoning") {
    return (
      <div className="rounded-md border bg-background/70 px-3 py-2 text-xs text-muted-foreground">
        <div className="mb-1 font-medium">Reasoning</div>
        <Streamdown isAnimating={isAnimating} className={streamdownClassName}>
          {part.text}
        </Streamdown>
      </div>
    );
  }

  if (part.type === "step-start") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="h-5 text-[10px]">
          step
        </Badge>
        <span>开始新一轮推理</span>
      </div>
    );
  }

  if (isToolUIPart(part)) {
    return (
      <ToolPartCard
        part={part}
        documents={documents}
        onOpenDocument={onOpenDocument}
        onApproveTool={onApproveTool}
        onAnswerClientTool={onAnswerClientTool}
      />
    );
  }

  if (part.type === "source-url") {
    return (
      <a
        href={part.url}
        target="_blank"
        rel="noreferrer"
        className="block rounded-md border bg-background/70 px-3 py-2 text-xs text-primary hover:underline"
      >
        {part.title ?? part.url}
      </a>
    );
  }

  return null;
}

function ToolPartCard({
  part,
  documents,
  onOpenDocument,
  onApproveTool,
  onAnswerClientTool,
}: {
  part: Extract<UIMessage["parts"][number], { toolCallId: string }>;
  documents: Map<string, ConversationDocument>;
  onOpenDocument: (documentId: string) => void;
  onApproveTool: (
    approvalId: string,
    approved: boolean,
    reason?: string,
  ) => void;
  onAnswerClientTool: (
    toolName: string,
    toolCallId: string,
    output: unknown,
  ) => void;
}) {
  const toolName = getToolName(part);
  const toolCallId = part.toolCallId;
  const state = part.state ?? "unknown";
  const input = "input" in part ? part.input : undefined;
  const output = "output" in part ? part.output : undefined;
  const approval = "approval" in part ? part.approval : undefined;
  const approvalId =
    approval && typeof approval === "object" && "id" in approval
      ? String(approval.id)
      : null;
  const artifactId = extractArtifactId(output);
  const askUserInput =
    toolName === "ask_user" ? parseAskUserInput(input) : null;

  if (artifactId) {
    return (
      <DocumentCard
        document={documents.get(artifactId)}
        documentId={artifactId}
        onOpen={() => onOpenDocument(artifactId)}
      />
    );
  }

  return (
    <Card className="rounded-md bg-background/80 text-foreground">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 p-3">
        <div className="min-w-0">
          <CardTitle className="truncate text-sm">{toolName}</CardTitle>
          <div className="mt-1 text-xs text-muted-foreground">
            {toolStateLabel(state)}
          </div>
        </div>
        <Badge
          variant={
            state === "output-error"
              ? "destructive"
              : state === "output-available"
                ? "secondary"
                : "outline"
          }
        >
          tool
        </Badge>
      </CardHeader>
      {state === "input-available" && askUserInput ? (
        <CardContent className="space-y-3 px-3 pt-0 pb-3">
          <div className="text-sm">{askUserInput.question}</div>
          {askUserInput.choices.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {askUserInput.choices.map((choice) => (
                <Button
                  key={choice.value}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={() =>
                    onAnswerClientTool(toolName, toolCallId, {
                      answer: choice.value,
                      label: choice.label,
                    })
                  }
                >
                  {choice.label}
                </Button>
              ))}
            </div>
          ) : null}
          {askUserInput.allowFreeform ? (
            <AskUserFreeform
              onSubmit={(answer) =>
                onAnswerClientTool(toolName, toolCallId, { answer })
              }
            />
          ) : null}
        </CardContent>
      ) : null}
      {state === "approval-requested" && approvalId ? (
        <CardContent className="space-y-3 px-3 pt-0 pb-3">
          <ToolJsonPreview value={input} />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              className="h-8"
              onClick={() => onApproveTool(approvalId, true)}
            >
              <CheckIcon className="mr-1 size-3" />
              批准执行
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() =>
                onApproveTool(approvalId, false, "User denied tool execution")
              }
            >
              <XIcon className="mr-1 size-3" />
              拒绝
            </Button>
          </div>
        </CardContent>
      ) : null}
      {state === "approval-responded" && approval ? (
        <CardContent className="px-3 pt-0 pb-3 text-xs text-muted-foreground">
          {"approved" in approval && approval.approved
            ? "已批准，Agent 将继续执行。"
            : "已拒绝，Agent 将基于拒绝结果继续。"}
        </CardContent>
      ) : null}
      {output !== undefined ? (
        <CardContent className="px-3 pt-0 pb-3">
          <ToolJsonPreview value={output} />
        </CardContent>
      ) : null}
    </Card>
  );
}

function toolStateLabel(state: string): string {
  switch (state) {
    case "input-streaming":
      return "参数生成中";
    case "input-available":
      return "等待执行";
    case "approval-requested":
      return "需要人工批准";
    case "approval-responded":
      return "审批已提交";
    case "output-available":
      return "执行完成";
    case "output-error":
      return "执行失败";
    default:
      return state;
  }
}

function AskUserFreeform({ onSubmit }: { onSubmit: (answer: string) => void }) {
  const [answer, setAnswer] = useState("");

  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = answer.trim();
        if (!trimmed) return;
        onSubmit(trimmed);
        setAnswer("");
      }}
    >
      <input
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        placeholder="输入你的回答..."
        className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
      />
      <Button type="submit" size="sm" className="h-8">
        提交
      </Button>
    </form>
  );
}

function ToolJsonPreview({ value }: { value: unknown }) {
  if (value === undefined) return null;
  return (
    <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded bg-muted/60 p-2 text-[11px] leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

type AskUserInput = {
  question: string;
  choices: Array<{ label: string; value: string }>;
  allowFreeform: boolean;
};

function parseAskUserInput(input: unknown): AskUserInput | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as {
    question?: unknown;
    choices?: unknown;
    allow_freeform?: unknown;
  };
  if (typeof raw.question !== "string" || !raw.question.trim()) return null;
  const choices = Array.isArray(raw.choices)
    ? raw.choices
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const choice = item as { label?: unknown; value?: unknown };
          if (
            typeof choice.label !== "string" ||
            typeof choice.value !== "string"
          ) {
            return null;
          }
          return { label: choice.label, value: choice.value };
        })
        .filter(
          (item): item is { label: string; value: string } => item != null,
        )
    : [];
  return {
    question: raw.question,
    choices,
    allowFreeform: raw.allow_freeform !== false,
  };
}

function extractArtifactId(output: unknown): string | null {
  if (!output || typeof output !== "object") return null;
  const candidate = (output as { document_id?: unknown }).document_id;
  return typeof candidate === "string" && /^[a-f0-9]{16}$/i.test(candidate)
    ? candidate
    : null;
}

function DocumentCard({
  document,
  documentId,
  onOpen,
}: {
  document: ConversationDocument | undefined;
  documentId: string;
  onOpen: () => void;
}) {
  return (
    <Card className="rounded-md bg-background/80 text-foreground">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 p-3">
        <div className="min-w-0">
          <CardTitle className="truncate text-sm">
            {document?.title ?? documentId}
          </CardTitle>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="h-5 text-[10px]">
              {document?.kind === "artifact" ? "artifact" : "source"}
            </Badge>
            <span className="truncate">
              {document?.filename ?? "document.md"}
            </span>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={onOpen}>
          预览/编辑
        </Button>
      </CardHeader>
      <CardContent className="px-3 pt-0 pb-3 text-xs text-muted-foreground">
        <FileTextIcon className="mr-1 inline size-3" />
        Markdown 文档
      </CardContent>
    </Card>
  );
}
