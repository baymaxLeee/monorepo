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
} from "@packages/components";
import {
  fetchTelemetryErrors,
  type TelemetryErrorEvent,
} from "@packages/api";
import { telemetry } from "@packages/observability";

const adminTelemetry = telemetry.scope({
  app: "mfe-admin",
  remoteName: "mfe-admin",
});

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

function shortId(value: string | null) {
  return value ? value.slice(0, 10) : "-";
}

export function OperationsObservabilityPage() {
  const [items, setItems] = useState<TelemetryErrorEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchTelemetryErrors(200)
      .then((data) => {
        setItems(data.items);
        adminTelemetry.event("observability_errors_loaded", {
          count: data.items.length,
        });
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        adminTelemetry.captureException(err, {
          area: "admin_observability",
        });
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(() => {
    const users = new Set(items.map((item) => item.user_id).filter(Boolean));
    const fingerprints = new Set(items.map((item) => item.fingerprint));
    const releases = new Set(items.map((item) => item.release).filter(Boolean));
    return {
      errors: items.length,
      fingerprints: fingerprints.size,
      releases: releases.size,
      users: users.size,
    };
  }, [items]);

  return (
    <Page>
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>可观测运维</PageTitle>
          <PageDescription>
            面向运维与技术人员的全量错误、用户、release 与 trace 视图
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

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="错误事件" value={summary.errors} />
        <MetricCard label="错误指纹" value={summary.fingerprints} />
        <MetricCard label="影响用户" value={summary.users} />
        <MetricCard label="版本数" value={summary.releases} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>错误事件流</CardTitle>
          <CardDescription>
            Admin 用户可查看全量数据，普通用户由 telemetry 服务自动按
            <InlineCode>user_id</InlineCode> 收敛
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
            <OpsTable items={items} />
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

function OpsTable({ items }: { items: TelemetryErrorEvent[] }) {
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
          <TableHead>应用</TableHead>
          <TableHead>用户</TableHead>
          <TableHead>错误</TableHead>
          <TableHead>指纹</TableHead>
          <TableHead>Trace</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={`${item.fingerprint}-${item.ts_server}`}>
            <TableCell className="whitespace-nowrap">
              {formatTime(item.ts_server)}
            </TableCell>
            <TableCell>
              <Badge variant="outline">{item.app}</Badge>
            </TableCell>
            <TableCell className="max-w-40 truncate">
              {item.username ?? item.user_id ?? "anonymous"}
            </TableCell>
            <TableCell>
              <div className="max-w-96">
                <div className="truncate font-medium">{item.message}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {item.route}
                </div>
              </div>
            </TableCell>
            <TableCell>
              <InlineCode>{shortId(item.fingerprint)}</InlineCode>
            </TableCell>
            <TableCell>
              <InlineCode>{shortId(item.trace_id)}</InlineCode>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
