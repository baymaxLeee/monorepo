import type { TraceSpan } from "api";
import { Badge, InlineCode, Skeleton } from "components";
import { useMemo } from "react";

import { formatTraceDuration, formatTraceTime } from "./trace-utils";

function spanDepths(spans: TraceSpan[]) {
  const byId = new Map(spans.map((span) => [span.span_id, span]));
  const memo = new Map<string, number>();
  const depthOf = (span: TraceSpan): number => {
    if (memo.has(span.span_id)) {
      return memo.get(span.span_id) ?? 0;
    }
    const parent = byId.get(span.parent_span_id);
    const depth = parent ? Math.min(depthOf(parent) + 1, 8) : 0;
    memo.set(span.span_id, depth);
    return depth;
  };
  return new Map(spans.map((span) => [span.span_id, depthOf(span)]));
}

function spanLabel(span: TraceSpan) {
  const attrs = span.span_attributes;
  return (
    attrs["agent.tool_name"] || attrs["agent.step_number"] || attrs["http.request.method"] || attrs["url.path"] || ""
  );
}

export function TraceTimeline({
  spans,
  loading,
  traceId,
}: {
  spans: TraceSpan[];
  loading: boolean;
  traceId: string | null;
}) {
  const depths = useMemo(() => spanDepths(spans), [spans]);
  if (!traceId) {
    return <div className="rounded-md border border-dashed p-6 text-sm">选择一条 trace 查看 timeline</div>;
  }
  if (loading && spans.length === 0) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  return (
    <div className="flex max-h-[calc(100vh-16rem)] flex-col gap-3 rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">Trace timeline</div>
          <InlineCode>{traceId}</InlineCode>
        </div>
        <Badge variant="outline">{spans.length} spans</Badge>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto">
        {spans.map((span) => {
          const label = spanLabel(span);
          const isError = span.status_code.toLowerCase().includes("error");
          return (
            <div
              key={span.span_id}
              className="rounded-lg border p-3"
              style={{
                marginLeft: `${(depths.get(span.span_id) ?? 0) * 18}px`,
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{span.span_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatTraceTime(span.timestamp)} · {span.service_name} · {span.span_kind}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {label ? <Badge variant="outline">{label}</Badge> : null}
                  <Badge variant={isError ? "destructive" : "secondary"}>{formatTraceDuration(span.duration_ms)}</Badge>
                </div>
              </div>
              {span.status_message ? <div className="mt-2 text-xs text-destructive">{span.status_message}</div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
