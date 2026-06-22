import {
  type ConversationDetail,
  type ConversationDocument,
  type ConversationDocumentDetail,
  fetchConversation,
  fetchConversationDocument,
  type Message,
  type ModelProvider,
  type ReasoningEffort,
  runConversationAgent,
  updateConversationDocument,
  uploadConversationDocument,
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
  SheetFooter,
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
  type PromptInputValue,
} from "components/prompt-input";
import {
  DownloadIcon,
  FileTextIcon,
  SettingsIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import { useShallow } from "zustand/react/shallow";
import { useChatStore } from "../store/useChatStore";

type StreamingMessage = Message & { streaming?: boolean };

const REASONING_OPTIONS: { value: ReasoningEffort; label: string }[] = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];
const STORAGE_KEY = "chat.reasoning-prefs.v1";
const MAX_ATTACHMENTS_PER_MESSAGE = 5;
const DOCUMENT_REF_RE = /\[\[chat-document:([a-zA-Z0-9_-]+)\]\]/g;

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

function documentRef(documentId: string) {
  return `[[chat-document:${documentId}]]`;
}

function buildUserDisplayContent(
  value: PromptInputValue,
  documents: ConversationDocument[],
) {
  const text = value.text.trim() || "请阅读附件并总结要点";
  if (documents.length === 0) return text;
  return [text, ...documents.map((document) => documentRef(document.id))].join(
    "\n\n",
  );
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
  return null;
}

export function ChatRoomPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<StreamingMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<ReasoningPrefs>(() => loadPrefs());
  const [attachmentCount, setAttachmentCount] = useState(0);
  const [documentOpen, setDocumentOpen] = useState(false);
  const [selectedDocument, setSelectedDocument] =
    useState<ConversationDocumentDetail | null>(null);
  const [documentDraft, setDocumentDraft] = useState("");
  const [htmlPreviewUrl, setHtmlPreviewUrl] = useState<string | null>(null);
  const [loadingDocument, setLoadingDocument] = useState(false);
  const [savingDocument, setSavingDocument] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const promptInputRef = useRef<PromptInputRef | null>(null);

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

  const documents = detail?.documents ?? [];
  const documentMap = useMemo(() => {
    const map = new Map<string, ConversationDocument>();
    for (const document of documents) map.set(document.id, document);
    return map;
  }, [documents]);
  const htmlPreview = useMemo(
    () => extractHtmlPreview(documentDraft),
    [documentDraft],
  );

  useEffect(() => {
    if (!documentOpen || !htmlPreview) {
      setHtmlPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(
      new Blob([htmlPreview], { type: "text/html" }),
    );
    setHtmlPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [documentOpen, htmlPreview]);

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

  const uploadPromptDocuments = useCallback(
    async (value: PromptInputValue) => {
      if (!id) return [];
      if (value.tokens.length > MAX_ATTACHMENTS_PER_MESSAGE) {
        toast.warning(`最多处理前 ${MAX_ATTACHMENTS_PER_MESSAGE} 个附件`);
      }
      const uploaded: ConversationDocumentDetail[] = [];
      for (const token of value.tokens.slice(0, MAX_ATTACHMENTS_PER_MESSAGE)) {
        const file = value.files[token.id];
        if (!file) continue;
        uploaded.push(await uploadConversationDocument(id, file));
      }
      if (uploaded.length > 0) {
        setDetail((prev) =>
          prev
            ? { ...prev, documents: [...prev.documents, ...uploaded] }
            : prev,
        );
      }
      return uploaded;
    },
    [id],
  );

  async function openDocument(documentId: string) {
    if (!id) return;
    setDocumentOpen(true);
    setLoadingDocument(true);
    try {
      const next = await fetchConversationDocument(id, documentId);
      setSelectedDocument(next);
      setDocumentDraft(next.content_md);
    } catch (e) {
      toast.error(String(e));
      setDocumentOpen(false);
    } finally {
      setLoadingDocument(false);
    }
  }

  async function saveDocument() {
    if (!id || !selectedDocument) return;
    setSavingDocument(true);
    try {
      const next = await updateConversationDocument(id, selectedDocument.id, {
        content_md: documentDraft,
      });
      setSelectedDocument(next);
      setDocumentDraft(next.content_md);
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
      toast.success("文档已保存");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSavingDocument(false);
    }
  }

  async function sendPrompt(value: PromptInputValue) {
    if (!id || sending) return;

    const rawContent = value.text.trim();
    if (!rawContent && value.tokens.length === 0) return;
    const content = rawContent || "请阅读附件并总结要点";

    setSending(id);
    try {
      const uploaded = await uploadPromptDocuments(value);
      const displayContent = buildUserDisplayContent(value, uploaded);
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
        content: "Agent 正在运行...",
        status: "streaming",
        created_at: now,
        streaming: true,
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      promptInputRef.current?.clear();
      setAttachmentCount(0);

      await runConversationAgent(id, {
        prompt: content,
        provider_id: effectiveProvider?.id ?? null,
        document_ids: uploaded.map((document) => document.id),
        thinking: prefs.thinking ? true : null,
        reasoning_effort: prefs.thinking ? prefs.effort : null,
      });
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
              last.content === "Agent 正在运行..."
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
            附件会先通过 MarkItDown 转为 Markdown 并存入当前会话。
          </span>
        </div>

        <div className="border-t p-3">
          <PromptInput
            ref={promptInputRef}
            placeholder="发送消息，或拖入文件让 MarkItDown 转成可编辑 Markdown..."
            disabled={sending || !hasProviders}
            loading={sending}
            onChange={(value) => setAttachmentCount(value.tokens.length)}
            footerRender={() => {
              return (
                <>
                  {attachmentCount > 0 ? (
                    <Badge variant="secondary" className="gap-1 text-xs">
                      <FileTextIcon className="size-3" />
                      MarkItDown x{" "}
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
        <SheetContent side="right" className="w-full gap-0 sm:max-w-4xl">
          <SheetHeader className="border-b">
            <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
              <div>
                <SheetTitle>{selectedDocument?.title ?? "文档预览"}</SheetTitle>
                <SheetDescription>
                  {selectedDocument
                    ? `${selectedDocument.kind === "artifact" ? "Agent 产物" : "上传文件"} · ${selectedDocument.filename}`
                    : "加载中..."}
                </SheetDescription>
              </div>
              {selectedDocument ? (
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
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {loadingDocument ? (
              <Skeleton className="h-96 w-full" />
            ) : selectedDocument ? (
              <div className="space-y-4">
                {htmlPreviewUrl ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Badge variant="outline">HTML iframe 预览</Badge>
                      <span className="text-xs text-muted-foreground">
                        由当前 Markdown 源码生成临时 URL
                      </span>
                    </div>
                    <iframe
                      title={selectedDocument.title}
                      src={htmlPreviewUrl}
                      sandbox="allow-scripts"
                      className="h-[70vh] w-full rounded-md border bg-white"
                    />
                  </div>
                ) : null}
                <MarkdownEditor
                  value={documentDraft}
                  contentType="markdown"
                  editable
                  toolbarMode="fixed"
                  className={
                    htmlPreviewUrl
                      ? "min-h-[42vh] rounded-md border"
                      : "min-h-[70vh] rounded-md border"
                  }
                  onChange={setDocumentDraft}
                />
              </div>
            ) : null}
          </div>
          <SheetFooter className="border-t">
            <Button
              type="button"
              disabled={!selectedDocument || savingDocument}
              onClick={() => void saveDocument()}
            >
              {savingDocument ? "保存中..." : "保存修改"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </Page>
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
  const parts = splitDocumentRefs(message.content);

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
        {parts.length > 0 ? (
          <div className="space-y-2">
            {parts.map((part) =>
              part.type === "document" ? (
                <DocumentCard
                  key={part.key}
                  document={documents.get(part.documentId)}
                  documentId={part.documentId}
                  onOpen={() => onOpenDocument(part.documentId)}
                />
              ) : isUser ? (
                <div
                  key={part.key}
                  className="whitespace-pre-wrap break-words leading-relaxed"
                >
                  {part.text}
                </div>
              ) : (
                <Streamdown
                  key={part.key}
                  isAnimating={isStreaming}
                  className="prose prose-sm max-w-none break-words leading-relaxed dark:prose-invert prose-p:my-1.5 prose-pre:my-2 prose-pre:rounded-md prose-code:before:content-none prose-code:after:content-none"
                >
                  {part.text}
                </Streamdown>
              ),
            )}
          </div>
        ) : message.content ? (
          <Streamdown
            isAnimating={isStreaming}
            className="prose prose-sm max-w-none break-words leading-relaxed dark:prose-invert prose-p:my-1.5 prose-pre:my-2 prose-pre:rounded-md prose-code:before:content-none prose-code:after:content-none"
          >
            {message.content}
          </Streamdown>
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

function splitDocumentRefs(content: string) {
  const parts: (
    | { type: "text"; key: string; text: string }
    | { type: "document"; key: string; documentId: string }
  )[] = [];
  let lastIndex = 0;
  for (const match of content.matchAll(DOCUMENT_REF_RE)) {
    const index = match.index ?? 0;
    const text = content.slice(lastIndex, index).trim();
    if (text) parts.push({ type: "text", key: `text-${lastIndex}`, text });
    parts.push({
      type: "document",
      key: `document-${index}-${match[1]}`,
      documentId: match[1],
    });
    lastIndex = index + match[0].length;
  }
  const tail = content.slice(lastIndex).trim();
  if (tail) parts.push({ type: "text", key: `text-${lastIndex}`, text: tail });
  return parts;
}
