import {
  attachBotSkill,
  type Bot,
  detachBotSkill,
  fetchBot,
  fetchBotSkills,
  fetchSkills,
  type SkillSummary,
} from "api";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Muted,
  Page,
  Separator,
  Skeleton,
  toast,
} from "components";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

export function BotDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bot, setBot] = useState<Bot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    fetchBot(id)
      .then((data) => alive && setBot(data))
      .catch((e) => alive && setError(String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id]);

  if (error) return <Navigate to="/404" replace />;

  return (
    <Page>
      <Button variant="ghost" size="sm" asChild>
        <Link to=".." relative="path">
          ← 返回列表
        </Link>
      </Button>

      {loading && (
        <Card className="max-w-lg">
          <CardHeader>
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-56" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </CardContent>
        </Card>
      )}

      {bot && (
        <>
          <Card className="max-w-lg">
            <CardHeader>
              <CardTitle>{bot.name}</CardTitle>
              <CardDescription>ID: {bot.id}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">状态</span>
                <Badge
                  variant={bot.status === "published" ? "default" : "secondary"}
                >
                  {bot.status}
                </Badge>
              </div>
              <Separator />
              <dl className="grid gap-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">创建时间</dt>
                  <dd>{new Date(bot.created_at).toLocaleString()}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <BotSkillsCard botId={bot.id} />
        </>
      )}
    </Page>
  );
}

function BotSkillsCard({ botId }: { botId: string }) {
  const [attached, setAttached] = useState<SkillSummary[] | null>(null);
  const [all, setAll] = useState<SkillSummary[]>([]);
  const [pickId, setPickId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchBotSkills(botId), fetchSkills()])
      .then(([bound, every]) => {
        if (!alive) return;
        setAttached(bound);
        setAll(every);
      })
      .catch((e) => toast.error(String(e)));
    return () => {
      alive = false;
    };
  }, [botId]);

  const available = useMemo(() => {
    const boundIds = new Set((attached ?? []).map((s) => s.id));
    return all.filter((s) => !boundIds.has(s.id));
  }, [all, attached]);

  async function attach() {
    if (!pickId) return;
    setBusy(true);
    try {
      setAttached(await attachBotSkill(botId, pickId));
      setPickId("");
      toast.success("已挂载技能");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function detach(skillId: string) {
    setBusy(true);
    try {
      setAttached(await detachBotSkill(botId, skillId));
      toast.success("已移除技能");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>技能</CardTitle>
        <CardDescription>
          该智能体对话时可通过 / 唤起的技能。仅 启用+激活 的技能会进入模型。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <select
            className="h-9 flex-1 rounded-md border bg-background px-3 text-sm"
            value={pickId}
            onChange={(e) => setPickId(e.target.value)}
            disabled={busy || available.length === 0}
          >
            <option value="">
              {available.length === 0 ? "无可挂载技能" : "选择要挂载的技能…"}
            </option>
            {available.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <Button onClick={attach} disabled={busy || !pickId}>
            挂载
          </Button>
        </div>
        <Separator />
        {attached === null ? (
          <Skeleton className="h-8 w-full" />
        ) : attached.length === 0 ? (
          <Muted>尚未挂载技能。</Muted>
        ) : (
          <ul className="space-y-2">
            {attached.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">{s.name}</span>
                    {!(s.is_enabled && s.status === "active") && (
                      <Badge variant="secondary">未激活</Badge>
                    )}
                  </div>
                  <p className="truncate text-muted-foreground">
                    {s.description}
                  </p>
                </div>
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => detach(s.id)}
                  disabled={busy}
                >
                  移除
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
