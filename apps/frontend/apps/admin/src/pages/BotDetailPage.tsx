import { type Bot, fetchBot } from "api";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Page,
  Separator,
  Skeleton,
} from "components";
import { useEffect, useState } from "react";
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
      )}
    </Page>
  );
}
