import {
  fetchObservabilityStatus,
  fetchTelemetryErrors,
  type ObservabilityStatus,
  type TelemetryErrorEvent,
} from "@repo/api";
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
} from "@repo/design-system";
import { telemetry } from "@repo/observability";
import { getErrorMessage } from "@repo/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

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
  const errorsQuery = useQuery({
    queryKey: ["telemetry", "errors", 200],
    queryFn: () => fetchTelemetryErrors(200, { skipErrorNotify: true }),
  });
  const statusQuery = useQuery({
    queryKey: ["telemetry", "observability-status"],
    queryFn: () => fetchObservabilityStatus({ skipErrorNotify: true }),
    refetchInterval: 30_000,
  });
  const items = errorsQuery.data?.items ?? [];
  const error = errorsQuery.error ?? statusQuery.error;

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

  useEffect(() => {
    if (errorsQuery.data) {
      adminTelemetry.event("observability_errors_loaded", {
        count: errorsQuery.data.items.length,
      });
    }
  }, [errorsQuery.data]);

  useEffect(() => {
    const queryError = errorsQuery.error ?? statusQuery.error;
    if (queryError) {
      adminTelemetry.captureException(queryError, {
        area: "admin_observability",
      });
    }
  }, [errorsQuery.error, statusQuery.error]);

  return (
    <Page>
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>可观测运维</PageTitle>
          <PageDescription>面向运维与技术人员的全量错误、用户、release 与 Trace 基座状态</PageDescription>
        </PageHeaderContent>
        <PageActions>
          <Button
            variant="outline"
            onClick={() => {
              void errorsQuery.refetch();
              void statusQuery.refetch();
            }}
            disabled={errorsQuery.isFetching || statusQuery.isFetching}
          >
            刷新
          </Button>
        </PageActions>
      </PageHeader>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>加载失败</AlertTitle>
          <AlertDescription>{getErrorMessage(error)}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="错误事件" value={summary.errors} />
        <MetricCard label="错误指纹" value={summary.fingerprints} />
        <MetricCard label="影响用户" value={summary.users} />
        <MetricCard label="版本数" value={summary.releases} />
      </div>

      <ObservabilityStatusPanel status={statusQuery.data} loading={statusQuery.isLoading} />

      <Card>
        <CardHeader>
          <CardTitle>错误事件流</CardTitle>
          <CardDescription>
            Admin 用户可查看全量数据，普通用户由 telemetry 服务自动按
            <InlineCode>user_id</InlineCode> 收敛
          </CardDescription>
        </CardHeader>
        <CardContent>
          {errorsQuery.isLoading && items.length === 0 ? (
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

function ObservabilityStatusPanel({ status, loading }: { status?: ObservabilityStatus; loading: boolean }) {
  if (loading && !status) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Trace 基座</CardTitle>
          <CardDescription>ClickHouse + OpenTelemetry Collector</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </CardContent>
      </Card>
    );
  }

  if (!status) {
    return null;
  }
  const clickhouseState = status.clickhouse.healthy ? "正常" : "异常";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Trace 基座</CardTitle>
        <CardDescription>ClickHouse + OTel Collector，明细保留 {status.trace_retention_days} 天</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">ClickHouse</span>
            <Badge variant={status.clickhouse.healthy ? "default" : "destructive"}>{clickhouseState}</Badge>
          </div>
          <div>
            <div className="text-2xl font-semibold">{status.clickhouse.spans_last_hour}</div>
            <div className="text-xs text-muted-foreground">近一小时 spans</div>
          </div>
          <div className="text-xs text-muted-foreground">OTLP: {status.otlp_endpoint ?? "未配置"}</div>
          {status.clickhouse.error ? <div className="text-xs text-destructive">{status.clickhouse.error}</div> : null}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {status.capabilities.map((item) => (
            <div key={item.key} className="rounded-lg border p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="font-medium">{item.label}</div>
                <Badge variant="outline">{item.status}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{item.detail}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
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
    return <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">暂无错误数据</div>;
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
            <TableCell className="whitespace-nowrap">{formatTime(item.ts_server)}</TableCell>
            <TableCell>
              <Badge variant="outline">{item.app}</Badge>
            </TableCell>
            <TableCell className="max-w-40 truncate">{item.username ?? item.user_id ?? "anonymous"}</TableCell>
            <TableCell>
              <div className="max-w-96">
                <div className="truncate font-medium">{item.message}</div>
                <div className="truncate text-xs text-muted-foreground">{item.route}</div>
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
