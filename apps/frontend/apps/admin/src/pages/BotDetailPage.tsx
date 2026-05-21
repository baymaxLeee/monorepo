import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
} from "@packages/components";
import { fetchBot, type Bot } from "@packages/api-client/admin";

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

  return (
    <div className="space-y-6 p-6">
      <Button variant="ghost" size="sm" asChild>
        <Link to=".." relative="path">
          ← 返回列表
        </Link>
      </Button>

      {loading && <p className="text-sm text-muted-foreground">加载中…</p>}

      {error && (
        <Alert variant="destructive">
          <AlertTitle>加载失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {bot && (
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>{bot.name}</CardTitle>
            <CardDescription>ID: {bot.id}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">状态</span>
              <Badge variant={bot.status === "published" ? "default" : "secondary"}>
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
      )}
    </div>
  );
}
