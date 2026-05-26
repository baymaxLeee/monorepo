import { useCallback, useEffect, useMemo, useState } from "react";
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
  InlineCode,
  Page,
  PageActions,
  PageDescription,
  PageHeader,
  PageHeaderContent,
  PageTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "components";
import {
  fetchTelemetryErrors,
  type TelemetryErrorEvent,
} from "api";

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

function shortId(value: string | null) {
  return value ? value.slice(0, 8) : "-";
}

export function ObservabilityPage() {
  const [items, setItems] = useState<TelemetryErrorEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchTelemetryErrors(100)
      .then((data) => setItems(data.items))
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(() => {
    const sessions = new Set(items.map((item) => item.session_id));
    const traces = new Set(items.map((item) => item.trace_id).filter(Boolean));
    return {
      errors: items.length,
      sessions: sessions.size,
      traces: traces.size,
    };
  }, [items]);

  return (
    <Page>
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>我的可观测数据</PageTitle>
          <PageDescription>
            当前登录用户的错误、会话与 trace 线索
          </PageDescription>
        </PageHeaderContent>
        <PageActions>
          <Button variant="outline" onClick={load} disabled={loading}>
            刷新
          </Button>
        </PageActions>
      </PageHeader>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>加载失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="错误数" value={summary.errors} />
        <MetricCard label="影响会话" value={summary.sessions} />
        <MetricCard label="关联 trace" value={summary.traces} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>最近错误</CardTitle>
          <CardDescription>
            按 <InlineCode>ts_server</InlineCode> 倒序展示
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading && items.length === 0 ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : (
            <ErrorTable items={items} />
          )}
        </CardContent>
      </Card>
    </Page>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function ErrorTable({ items }: { items: TelemetryErrorEvent[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        暂无错误数据
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>时间</TableHead>
          <TableHead>路由</TableHead>
          <TableHead>错误</TableHead>
          <TableHead>Session</TableHead>
          <TableHead>Trace</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={`${item.fingerprint}-${item.ts_server}`}>
            <TableCell className="whitespace-nowrap">
              {formatTime(item.ts_server)}
            </TableCell>
            <TableCell className="max-w-44 truncate">{item.route}</TableCell>
            <TableCell>
              <div className="max-w-96">
                <div className="truncate font-medium">{item.message}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {item.name}
                </div>
              </div>
            </TableCell>
            <TableCell>
              <Badge variant="outline">{shortId(item.session_id)}</Badge>
            </TableCell>
            <TableCell>
              <Badge variant="secondary">{shortId(item.trace_id)}</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default ObservabilityPage;
