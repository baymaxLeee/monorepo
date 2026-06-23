import {
  type AgentRunStreamEvent,
  type ConversationDetail,
  type ConversationDocument,
  type ConversationDocumentDetail,
  type DocumentIngestStreamEvent,
  fetchConversation,
  fetchConversationDocument,
  fetchConversationDocumentSource,
  type Message,
  type ModelProvider,
  type ReasoningEffort,
  resumeConversationAgent,
  streamConversationAgent,
  streamConversationDocumentIngest,
  updateConversationDocument,
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
import { PromptMessageContent, extractSlotIdsFromContent } from "components/prompt-message-content";
import { extractSlotIds, parseSlots, serializeSlots, tokenIdByArtifactId } from "shared";
import { DownloadIcon, FileTextIcon, SettingsIcon } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import { useShallow } from "zustand/react/shallow";
import { useChatStore } from "../store/useChatStore";

type AgentProgress = {
  steps: AgentProgressStep[];
  message: string;
  cards: AgentProgressCard[];
};

type StreamingMessage = Message & {
  streaming?: boolean;
  agentProgress?: AgentProgress;
};

type AgentProgressStep = {
  id: string;
  text: string;
  status: "pending" | "running" | "completed" | "failed";
  toolName?: string;
  outputPreview?: string;
};

type AgentProgressCard = {
  id: string;
  type: "artifact" | "chart";
  document?: ConversationDocument;
};

const REASONING_OPTIONS: { value: ReasoningEffort; label: string }[] = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];
const STORAGE_KEY = "chat.reasoning-prefs.v1";
const MAX_ATTACHMENTS_PER_MESSAGE = 5;
const MULTIMODAL_PROVIDER_HINT_RE =
  /doubao|seed|vision|image|multimodal|video/i;
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

function placeholderId(role: "user" | "assistant") {
  return `local-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildPromptContent(value: PromptInputValue): string {
  const serialized = serializeSlots(
    { segments: value.segments },
    tokenIdByArtifactId(value.tokens),
  );
  return serialized.trim() || "请阅读附件并总结要点";
}

function createEmptyAgentProgress(): AgentProgress {
  return { steps: [], message: "", cards: [] };
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

function resolveDocumentPreviewMode(
  document: ConversationDocumentDetail,
): DocumentPreviewMode {
  const mime = (
    document.source_mime_type ||
    document.mime_type ||
    ""
  ).toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
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

export function ChatRoomPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<StreamingMessage[]>([]);
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

  const {
    sending,
    setSending,
    providers,
    providersError,
    isLoadingProviders,
    selectedProviderId,
    setSelectedProviderId,
  } = useChatStore(
    useShallow((state) => ({
      sending: state.sendingConversationId === id,
      setSending: state.setSendingConversationId,
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
  const inferredMultimodalProvider =
    enabledProviders.find((p) =>
      MULTIMODAL_PROVIDER_HINT_RE.test(`${p.name} ${p.model} ${p.base_url}`),
    ) ?? null;
  const effectiveMultimodalProvider =
    selectedMultimodalProviderId === MULTIMODAL_PROVIDER_NONE
      ? null
      : selectedMultimodalProviderId === MULTIMODAL_PROVIDER_AUTO
        ? inferredMultimodalProvider
        : (enabledProviders.find(
            (p) => p.id === selectedMultimodalProviderId,
          ) ?? null);

  const documents = detail?.documents ?? [];
  const documentMap = useMemo(() => {
    const map = new Map<string, ConversationDocument>();
    for (const document of documents) map.set(document.id, document);
    return map;
  }, [documents]);

  const updateAgentProgress = useCallback(
    (
      updater: (progress: AgentProgress) => AgentProgress,
      status: "streaming" | "ok" | "failed" = "streaming",
    ) => {
      if (!id) return;
      setMessages((prev) => {
        const next = [...prev];
        let index = next.length - 1;
        let current = next[index];
        if (current?.role !== "assistant" || !current.agentProgress) {
          current = {
            id: placeholderId("assistant"),
            conversation_id: id,
            role: "assistant",
            content: "",
            status: "streaming",
            created_at: new Date().toISOString(),
            streaming: true,
            agentProgress: createEmptyAgentProgress(),
          };
          next.push(current);
          index = next.length - 1;
        }

        next[index] = {
          ...current,
          status,
          streaming: status === "streaming",
          agentProgress: updater(
            current.agentProgress ?? createEmptyAgentProgress(),
          ),
        };
        return next;
      });
    },
    [id],
  );

  const applyAgentEvent = useCallback(
    (event: AgentRunStreamEvent) => {
      if (event.type === "step") {
        updateAgentProgress((progress) => ({
          ...progress,
          steps: [
            ...progress.steps,
            {
              text: event.text,
              id: placeholderId("assistant"),
              status: event.status ?? "completed",
              toolName: event.tool_name,
              outputPreview: event.output_preview,
            },
          ],
        }));
        return;
      }
      if (event.type === "message") {
        if (event.status === "failed") {
          updateAgentProgress(
            (progress) => ({
              ...progress,
              message: event.text || progress.message || "agent runtime failed",
            }),
            "failed",
          );
          return;
        }
        updateAgentProgress(
          (progress) => ({
            ...progress,
            message:
              event.delta !== undefined
                ? progress.message + event.delta
                : event.text || progress.message,
          }),
          event.status === "completed" ? "ok" : "streaming",
        );
        return;
      }
      if (event.type === "card") {
        const { card } = event;
        const document = card.document;
        if (document) {
          setDetail((prev) =>
            prev
              ? {
                  ...prev,
                  documents: mergeDocumentsById(prev.documents, [document]),
                }
              : prev,
          );
        }
        updateAgentProgress((progress) => ({
          ...progress,
          cards: [
            ...progress.cards,
            {
              id: document?.id ?? placeholderId("assistant"),
              type: card.type,
              document,
            },
          ],
        }));
        return;
      }
      if (event.type === "error") {
        throw new Error(event.message);
      }
    },
    [updateAgentProgress],
  );

  useEffect(() => {
    if (!documentOpen || documentPreviewMode !== "html") {
      setHtmlPreviewUrl(null);
      return;
    }
    const html = selectedDocument
      ? extractHtmlPreview(selectedDocument.content_md)
      : null;
    if (!html) {
      setHtmlPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    setHtmlPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [documentOpen, documentPreviewMode, selectedDocument]);

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
      void updateConversationDocument(id, selectedDocument.id, {
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
    setLoading(true);
    setError(null);
    try {
      const next = await fetchConversation(id);
      setDetail(next);
      setMessages(next.messages);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    resumedConversationRef.current = null;
  }, [id]);

  useEffect(() => {
    if (!id || loading || sending || resumedConversationRef.current === id) {
      return;
    }
    resumedConversationRef.current = id;
    const controller = new AbortController();
    let receivedEvents = false;

    void resumeConversationAgent(id, {
      signal: controller.signal,
      onEvent: (event) => {
        receivedEvents = true;
        applyAgentEvent(event);
      },
    })
      .then(async () => {
        if (!receivedEvents || controller.signal.aborted) return;
        const next = await fetchConversation(id);
        setDetail(next);
        setMessages(next.messages);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        toast.error(String(e));
      });

    return () => controller.abort();
  }, [applyAgentEvent, id, loading, sending]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, []);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const updatePrefs = useCallback((patch: Partial<ReasoningPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      savePrefs(next);
      return next;
    });
  }, []);

  const applyIngestEvent = useCallback((event: DocumentIngestStreamEvent) => {
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
          prev
            ? {
                ...prev,
                documents: mergeDocumentsById(prev.documents, [
                  event.document,
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
  }, []);

  const flushIngestQueue = useCallback(async () => {
    if (!id || ingestQueueRef.current.length === 0) return;
    const batch = ingestQueueRef.current.splice(
      0,
      MAX_ATTACHMENTS_PER_MESSAGE,
    );
    ingestAbortRef.current?.abort();
    const controller = new AbortController();
    ingestAbortRef.current = controller;
    setIngestInFlight(true);
    try {
      await streamConversationDocumentIngest(
        id,
        batch.map((item) => ({
          clientRef: item.clientRef,
          file: item.file,
        })),
        {
          signal: controller.signal,
          onEvent: applyIngestEvent,
        },
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      toast.error(String(error));
    } finally {
      setIngestInFlight(false);
    }
  }, [applyIngestEvent, id]);

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
    setDocumentOpen(true);
    setLoadingDocument(true);
    setMediaPreviewUrl(null);
    setHtmlPreviewUrl(null);
    try {
      const next = await fetchConversationDocument(id, documentId);
      const mode = resolveDocumentPreviewMode(next);
      setSelectedDocument(next);
      setDocumentDraft(next.content_md);
      setDocumentPreviewMode(mode);
      if (mode === "image" || mode === "video" || mode === "audio") {
        const blob = await fetchConversationDocumentSource(id, documentId);
        setMediaPreviewUrl(URL.createObjectURL(blob));
      }
    } catch (e) {
      toast.error(String(e));
      setDocumentOpen(false);
    } finally {
      setLoadingDocument(false);
    }
  }

  async function sendPrompt(value: PromptInputValue) {
    if (!id || sending) return;

    const displayContent = buildPromptContent(value);
    if (!displayContent && value.tokens.length === 0) return;

    setSending(id);
    try {
      const now = new Date().toISOString();
      const userMsg: StreamingMessage = {
        id: placeholderId("user"),
        conversation_id: id,
        role: "user",
        content: displayContent,
        status: "ok",
        created_at: now,
      };
      const assistantMsg: StreamingMessage = {
        id: placeholderId("assistant"),
        conversation_id: id,
        role: "assistant",
        content: "",
        status: "streaming",
        created_at: now,
        streaming: true,
        agentProgress: createEmptyAgentProgress(),
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      promptInputRef.current?.clear();
      setAttachmentCount(0);

      await streamConversationAgent(
        id,
        {
          prompt: displayContent,
          provider_id: effectiveProvider?.id ?? null,
          multimodal_provider_id: effectiveMultimodalProvider?.id ?? null,
          document_ids: extractSlotIds(displayContent),
          thinking: prefs.thinking ? true : null,
          reasoning_effort: prefs.thinking ? prefs.effort : null,
        },
        {
          onEvent: applyAgentEvent,
        },
      );
      const refreshed = await fetchConversation(id);
      setDetail(refreshed);
      setMessages(refreshed.messages);
    } catch (e) {
      const message = String(e);
      toast.error(message);
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant") {
          next[next.length - 1] = {
            ...last,
            content:
              !last.agentProgress?.message &&
              last.agentProgress?.steps.length === 0
                ? "[chat] 请求失败，请稍后重试或检查后端配置。"
                : last.content,
            status: "failed",
            streaming: false,
          };
        }
        return next;
      });
    } finally {
      setSending(null);
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
              共 {messages.length} 条消息，按 Cmd/Ctrl + Enter 也可发送
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
          {loading && messages.length === 0 ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-2/3" />
              <Skeleton className="ml-auto h-16 w-3/4" />
              <Skeleton className="h-12 w-1/2" />
            </div>
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              开始你的第一条消息吧。
            </p>
          ) : (
            messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                documents={documentMap}
                onOpenDocument={(documentId) => void openDocument(documentId)}
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
              disabled={!hasProviders || sending}
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
              disabled={!hasProviders || sending}
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
              disabled={sending}
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
              disabled={!prefs.thinking || sending}
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
          <span className="ml-auto text-xs text-muted-foreground">
            附件会在输入时并行导入，全部就绪后才能发送。
          </span>
        </div>

        <div className="border-t p-3">
          <PromptInput
            ref={promptInputRef}
            placeholder="发送消息，或拖入文件让 MarkItDown 转成可编辑 Markdown..."
            disabled={sending || !hasProviders}
            loading={sending || ingestInFlight}
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
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden p-4">
            {loadingDocument ? (
              <Skeleton className="h-96 w-full" />
            ) : selectedDocument ? (
              documentPreviewMode === "image" && mediaPreviewUrl ? (
                <div className="flex h-full min-h-0 items-center justify-center">
                  <img
                    src={mediaPreviewUrl}
                    alt={selectedDocument.title}
                    className="max-h-full max-w-full rounded-md border object-contain"
                  />
                </div>
              ) : documentPreviewMode === "video" && mediaPreviewUrl ? (
                <video
                  src={mediaPreviewUrl}
                  controls
                  className="max-h-full w-full rounded-md border bg-black"
                />
              ) : documentPreviewMode === "audio" && mediaPreviewUrl ? (
                <div className="flex h-full items-center justify-center">
                  <audio
                    src={mediaPreviewUrl}
                    controls
                    className="w-full max-w-lg"
                  />
                </div>
              ) : documentPreviewMode === "html" && htmlPreviewUrl ? (
                <div className="flex h-full min-h-0 min-w-0 flex-col gap-2">
                  <div className="flex shrink-0 items-center justify-between">
                    <Badge variant="outline">HTML iframe 预览</Badge>
                    <span className="text-xs text-muted-foreground">
                      由当前文档源码生成临时 URL
                    </span>
                  </div>
                  <iframe
                    title={selectedDocument.title}
                    src={htmlPreviewUrl}
                    sandbox="allow-scripts"
                    className="min-h-0 w-full flex-1 rounded-md border bg-white"
                  />
                </div>
              ) : (
                <div className="h-full min-h-0 min-w-0 w-full overflow-hidden">
                  <MarkdownEditor
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

function AssistantSlotMessageContent({
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
      {segments.map((segment, index) =>
        segment.type === "slot" ? (
          <DocumentCard
            key={`${segment.documentId}-${index}`}
            document={documents.get(segment.documentId)}
            documentId={segment.documentId}
            onOpen={() => onOpenDocument(segment.documentId)}
          />
        ) : segment.text.trim() ? (
          <Streamdown
            key={`text-${index}`}
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
}: {
  message: StreamingMessage;
  documents: Map<string, ConversationDocument>;
  onOpenDocument: (documentId: string) => void;
}) {
  const isUser = message.role === "user";
  const isStreaming =
    Boolean(message.streaming) || message.status === "streaming";
  const progress = message.agentProgress;
  const messageBody = progress?.message ?? message.content;
  const slotIdsInMessage = extractSlotIdsFromContent(messageBody);
  const slotIdSet = new Set(slotIdsInMessage);

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
          {message.status === "failed" ? (
            <Badge variant="destructive" className="h-4 px-1 text-[10px]">
              失败
            </Badge>
          ) : isStreaming ? (
            <Badge variant="secondary" className="h-4 px-1 text-[10px]">
              输出中...
            </Badge>
          ) : null}
        </div>
        {progress ? (
          <div className="space-y-3">
            {progress.steps.length > 0 ? (
              <ul className="space-y-1 text-xs text-muted-foreground">
                {progress.steps.map((step) => (
                  <li key={step.id} className="space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="h-5 text-[10px]">
                        {step.status}
                      </Badge>
                      {step.toolName ? (
                        <span className="font-mono text-[11px]">
                          {step.toolName}
                        </span>
                      ) : null}
                      <span>{step.text}</span>
                    </div>
                    {step.outputPreview ? (
                      <div className="line-clamp-2 rounded bg-background/70 px-2 py-1 font-mono text-[11px]">
                        {step.outputPreview}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : isStreaming ? (
              <div className="text-xs text-muted-foreground">准备中...</div>
            ) : null}
            {messageBody ? (
              isUser ? (
                <PromptMessageContent
                  content={messageBody}
                  documents={documents}
                  onOpenDocument={onOpenDocument}
                />
              ) : (
                <AssistantSlotMessageContent
                  content={messageBody}
                  documents={documents}
                  isAnimating={isStreaming}
                  onOpenDocument={onOpenDocument}
                />
              )
            ) : null}
            {progress && progress.cards.length > 0 ? (
              <div className="space-y-2">
                {progress.cards
                  .filter(
                    (card) =>
                      !card.document?.id || !slotIdSet.has(card.document.id),
                  )
                  .map((card) =>
                    card.type === "artifact" && card.document ? (
                      <DocumentCard
                        key={card.document.id}
                        document={card.document}
                        documentId={card.document.id}
                        onOpen={() => onOpenDocument(card.document!.id)}
                      />
                    ) : (
                      <Card key={card.id} className="rounded-md">
                        <CardHeader className="p-3">
                          <CardTitle className="text-sm">{card.type}</CardTitle>
                        </CardHeader>
                      </Card>
                    ),
                  )}
              </div>
            ) : null}
          </div>
        ) : message.content ? (
          isUser ? (
            <PromptMessageContent
              content={message.content}
              documents={documents}
              onOpenDocument={onOpenDocument}
            />
          ) : (
            <AssistantSlotMessageContent
              content={message.content}
              documents={documents}
              isAnimating={isStreaming}
              onOpenDocument={onOpenDocument}
            />
          )
        ) : (
          <div className="text-muted-foreground">...</div>
        )}
      </div>
    </div>
  );
});

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
