import { useQuery } from "@tanstack/react-query";
import { fetchObservabilityTrace, fetchObservabilityTraces, type TraceSummary } from "api";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  InlineCode,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "components";
import { useState } from "react";

import { formatTraceDuration, formatTraceTime, shortTraceId } from "./trace-utils";
import { TraceTimeline } from "./TraceTimeline";

export function TraceExplorer() {
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const tracesQuery = useQuery({
    queryKey: ["telemetry", "traces", 50, 60],
    queryFn: () => fetchObservabilityTraces({ limit: 50, minutes: 60 }, { skipErrorNotify: true }),
    refetchInterval: 30_000,
  });
  const selected = selectedTraceId ?? tracesQuery.data?.items[0]?.trace_id ?? null;
  const detailQuery = useQuery({
    queryKey: ["telemetry", "trace", selected],
    queryFn: () => fetchObservabilityTrace(selected ?? "", { skipErrorNotify: true }),
    enabled: Boolean(selected),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>最近 traces</CardTitle>
            <CardDescription>
              最近 1 小时的后端 trace, 点击后查看 gateway / chat / agent / 下游服务 timeline
            </CardDescription>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              void tracesQuery.refetch();
              void detailQuery.refetch();
            }}
            disabled={tracesQuery.isFetching || detailQuery.isFetching}
          >
            刷新 traces
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(420px,1.2fr)]">
        <TraceList
          items={tracesQuery.data?.items ?? []}
          loading={tracesQuery.isLoading}
          selectedTraceId={selected}
          onSelect={setSelectedTraceId}
        />
        <TraceTimeline spans={detailQuery.data?.spans ?? []} loading={detailQuery.isLoading} traceId={selected} />
      </CardContent>
    </Card>
  );
}

function TraceList({
  items,
  loading,
  selectedTraceId,
  onSelect,
}: {
  items: TraceSummary[];
  loading: boolean;
  selectedTraceId: string | null;
  onSelect: (traceId: string) => void;
}) {
  if (loading && items.length === 0) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        暂无 trace。启动 dev 服务并发起一次 chat SSE 后会出现在这里。
      </div>
    );
  }
  return (
    <div className="max-h-[calc(100vh-16rem)] overflow-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>开始</TableHead>
            <TableHead>Trace</TableHead>
            <TableHead>服务</TableHead>
            <TableHead>耗时</TableHead>
            <TableHead>Spans</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((trace) => (
            <TableRow
              key={trace.trace_id}
              className={selectedTraceId === trace.trace_id ? "bg-muted/60" : ""}
              onClick={() => onSelect(trace.trace_id)}
            >
              <TableCell className="whitespace-nowrap">{formatTraceTime(trace.started_at)}</TableCell>
              <TableCell>
                <div className="space-y-1">
                  <InlineCode>{shortTraceId(trace.trace_id)}</InlineCode>
                  <div className="max-w-52 truncate text-xs text-muted-foreground">
                    {trace.root_span_name ?? "root span 未知"}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex max-w-48 flex-wrap gap-1">
                  {trace.services.map((service) => (
                    <Badge key={service} variant="outline">
                      {service}
                    </Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell>{formatTraceDuration(trace.duration_ms)}</TableCell>
              <TableCell>
                <Badge variant={trace.error_count > 0 ? "destructive" : "secondary"}>
                  {trace.span_count}
                  {trace.error_count > 0 ? ` / ${trace.error_count} err` : ""}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
