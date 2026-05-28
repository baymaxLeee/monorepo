import {
  type ConversationDetail,
  fetchConversation,
  type Message,
  type ReasoningEffort,
  streamChatMessage,
} from "api";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
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
  Skeleton,
  Switch,
  Textarea,
  toast,
} from "components";
import { SendHorizonalIcon } from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useChatStore } from "../store/useChatStore";

type StreamingMessage = Message & { streaming?: boolean };

const REASONING_OPTIONS: { value: ReasoningEffort; label: string }[] = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

// Persist the user's reasoning preference across reloads. Scoped per browser,
// not per conversation — most users want the same setting everywhere.
const STORAGE_KEY = "chat.reasoning-prefs.v1";
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

export function ChatRoomPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<StreamingMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [prefs, setPrefs] = useState<ReasoningPrefs>(() => loadPrefs());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const updatePrefs = useCallback((patch: Partial<ReasoningPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      savePrefs(next);
      return next;
    });
  }, []);

  const { sending, setSending } = useChatStore(
    useShallow((state) => ({
      sending: state.sendingConversationId === id,
      setSending: state.setSendingConversationId,
    })),
  );

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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id) return;
    const content = draft.trim();
    if (!content || sending) return;

    setSending(id);
    setDraft("");
    const now = new Date().toISOString();
    const userMsg: StreamingMessage = {
      id: placeholderId("user"),
      conversation_id: id,
      role: "user",
      content,
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
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    try {
      await streamChatMessage(
        id,
        {
          content,
          // Only forward when thinking is on — keeps the request payload tiny
          // for backends that don't recognise these vendor extensions.
          thinking: prefs.thinking ? true : null,
          reasoning_effort: prefs.thinking ? prefs.effort : null,
        },
        {
          onChunk: (chunk) => {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === "assistant") {
                next[next.length - 1] = {
                  ...last,
                  content: last.content + chunk,
                };
              }
              return next;
            });
          },
        },
      );
      // Refresh from server to materialize the canonical ids/timestamps.
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
              last.content || "[chat] 请求失败，请稍后重试或检查后端配置。",
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
            {detail?.title ?? (loading ? "加载中…" : "对话")}
          </PageTitle>
          <PageDescription className="flex items-center gap-2">
            {detail?.model ? (
              <Badge variant="outline" className="font-mono text-xs">
                {detail.model}
              </Badge>
            ) : null}
            <span>共 {messages.length} 条消息，按 ⌘/Ctrl + Enter 也可发送</span>
          </PageDescription>
        </PageHeaderContent>
      </PageHeader>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>会话加载失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
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
            messages.map((m) => <MessageBubble key={m.id} message={m} />)
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-3 py-2 text-sm">
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
            仅当模型支持时生效（如 DeepSeek V4 / R1、Anthropic 推理模型）
          </span>
        </div>

        <form onSubmit={onSubmit} className="flex items-end gap-2 border-t p-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                (
                  e.currentTarget.form as HTMLFormElement | null
                )?.requestSubmit();
              }
            }}
            placeholder="向模型发送一条消息…"
            rows={2}
            className="min-h-[3rem] flex-1 resize-none"
            disabled={sending}
            aria-label="消息输入框"
          />
          <Button
            type="submit"
            disabled={!draft.trim() || sending}
            className="gap-1"
          >
            <SendHorizonalIcon aria-hidden="true" className="size-4" />
            {sending ? "回复中…" : "发送"}
          </Button>
        </form>
      </div>
    </Page>
  );
}

function MessageBubble({ message }: { message: StreamingMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm shadow-sm ${
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
          ) : message.streaming || message.status === "streaming" ? (
            <Badge variant="secondary" className="h-4 px-1 text-[10px]">
              输出中…
            </Badge>
          ) : null}
        </div>
        <div className="whitespace-pre-wrap break-words leading-relaxed">
          {message.content || (message.streaming ? "…" : "")}
        </div>
      </div>
    </div>
  );
}
