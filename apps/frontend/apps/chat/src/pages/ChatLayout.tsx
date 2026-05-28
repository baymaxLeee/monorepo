import {
  type Conversation,
  createConversation,
  deleteConversation,
  fetchConversations,
} from "api";
import {
  Aside,
  Button,
  Layout,
  Main,
  Section,
  Skeleton,
  toast,
} from "components";
import { MessageSquareIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";

export function ChatLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [conversations, setConversations] = useState<Conversation[] | null>(
    null,
  );
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await fetchConversations();
      setConversations(list);
      return list;
    } catch (error) {
      toast.error(`加载会话失败：${String(error)}`);
      setConversations([]);
      return [] as Conversation[];
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    try {
      const conv = await createConversation({});
      setConversations((prev) => (prev ? [conv, ...prev] : [conv]));
      navigate(`/platform/chat/conversations/${conv.id}`);
    } catch (error) {
      toast.error(`新建会话失败：${String(error)}`);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteConversation(id);
      const list = await load();
      if (location.pathname.includes(id)) {
        const next = list[0];
        navigate(
          next
            ? `/platform/chat/conversations/${next.id}`
            : "/platform/chat/conversations",
          { replace: true },
        );
      }
    } catch (error) {
      toast.error(`删除会话失败：${String(error)}`);
    }
  }

  return (
    <Layout className="min-h-[calc(100svh-3.5rem)] flex-row">
      <Aside className="w-64 shrink-0 gap-3 p-3">
        <div className="flex items-center justify-between px-2">
          <span className="text-xs font-medium text-muted-foreground">
            会话
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={handleCreate}
            disabled={creating}
            aria-label="新建会话"
            className="h-7 gap-1 px-2 text-xs"
          >
            <PlusIcon aria-hidden="true" className="size-3.5" />
            新建
          </Button>
        </div>

        <Section className="gap-1">
          {conversations === null ? (
            <div className="space-y-2 px-1">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-3/4" />
            </div>
          ) : conversations.length === 0 ? (
            <p className="px-2 text-xs text-muted-foreground">
              暂无会话，点击右上「新建」开始对话。
            </p>
          ) : (
            <nav className="grid gap-1" aria-label="会话列表">
              {conversations.map((c) => {
                const active = location.pathname.endsWith(`/${c.id}`);
                return (
                  <div key={c.id} className="group flex items-center gap-1">
                    <Button
                      asChild
                      variant={active ? "secondary" : "ghost"}
                      className="h-auto flex-1 justify-start gap-2 px-2 py-1.5 text-left"
                    >
                      <Link to={`/platform/chat/conversations/${c.id}`}>
                        <MessageSquareIcon
                          aria-hidden="true"
                          className="size-4 shrink-0"
                        />
                        <span className="truncate text-sm">{c.title}</span>
                      </Link>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`删除 ${c.title}`}
                      onClick={() => handleDelete(c.id)}
                      className="h-7 w-7 p-0 opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <Trash2Icon
                        aria-hidden="true"
                        className="size-3.5 text-muted-foreground"
                      />
                    </Button>
                  </div>
                );
              })}
            </nav>
          )}
        </Section>
      </Aside>
      <Main className="overflow-auto">
        <Outlet />
      </Main>
    </Layout>
  );
}
