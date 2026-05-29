import {
  fetchTelemetryErrors,
  fetchTelemetryPerformance,
  type TelemetryErrorEvent,
  type TelemetryPerformanceEvent,
} from "api";
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
import type { EChartsOption } from "echarts";
import { BarChart, LineChart, PieChart, ScatterChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { type EChartsType, init, use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePlatformStore } from "runtime";

use([
  BarChart,
  CanvasRenderer,
  GridComponent,
  LegendComponent,
  LineChart,
  PieChart,
  ScatterChart,
  TooltipComponent,
]);

type CountItem = {
  name: string;
  value: number;
};

type DashboardData = {
  apps: CountItem[];
  errorsByHour: CountItem[];
  fingerprints: CountItem[];
  releases: CountItem[];
  routes: CountItem[];
  sessionPoints: [number, number][];
  sessions: number;
  traces: number;
};

type VitalMetric = "fcp" | "lcp" | "inp" | "cls" | "ttfb";

type VitalSummary = {
  count: number;
  metric: VitalMetric;
  p75: number | null;
  rating: string | null;
};

const VITAL_LABELS: Record<VitalMetric, string> = {
  cls: "CLS",
  fcp: "FCP",
  inp: "INP",
  lcp: "LCP",
  ttfb: "TTFB",
};

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

export function HomePage() {
  const user = usePlatformStore((state) => state.user);
  const [items, setItems] = useState<TelemetryErrorEvent[]>([]);
  const [performanceItems, setPerformanceItems] = useState<
    TelemetryPerformanceEvent[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([fetchTelemetryErrors(200), fetchTelemetryPerformance(500)])
      .then(([errors, performance]) => {
        setItems(errors.items);
        setPerformanceItems(performance.items);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const data = useMemo(() => buildDashboardData(items), [items]);
  const vitals = useMemo(
    () => buildVitalSummaries(performanceItems),
    [performanceItems],
  );

  return (
    <Page>
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>Dashboard</PageTitle>
          <PageDescription>
            {user ? `${user.displayName} 的可观测视图` : "可观测视图"}
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
        <MetricCard label="错误事件" value={items.length} />
        <MetricCard label="影响会话" value={data.sessions} />
        <MetricCard label="关联 Trace" value={data.traces} />
        <MetricCard label="版本数" value={data.releases.length} />
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        {vitals.map((item) => (
          <VitalCard key={item.metric} item={item} />
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <ChartPanel
          className="xl:col-span-8"
          description="按服务端时间聚合"
          option={lineOption("错误趋势", data.errorsByHour)}
          title="错误趋势"
        />
        <ChartPanel
          className="xl:col-span-4"
          description="按 app 聚合"
          option={pieOption("应用分布", data.apps)}
          title="应用分布"
        />
        <ChartPanel
          className="xl:col-span-5"
          description="出现最多的路由"
          option={barOption("路由 Top", data.routes)}
          title="路由 Top"
        />
        <ChartPanel
          className="xl:col-span-4"
          description="错误指纹聚合"
          option={barOption("错误指纹", data.fingerprints)}
          title="错误指纹 Top"
        />
        <ChartPanel
          className="xl:col-span-3"
          description="版本分布"
          option={pieOption("版本", data.releases)}
          title="版本分布"
        />
        <ChartPanel
          className="xl:col-span-12"
          description="每个点代表一个错误事件"
          option={scatterOption(data.sessionPoints)}
          title="会话时间线"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>最近错误</CardTitle>
          <CardDescription>
            当前用户可见范围内的 <InlineCode>errors</InlineCode> 事件
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
            <RecentErrors items={items} />
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

function VitalCard({ item }: { item: VitalSummary }) {
  return (
    <Card>
      <CardHeader className="space-y-2 pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardDescription>{VITAL_LABELS[item.metric]}</CardDescription>
          {item.rating ? <Badge variant="outline">{item.rating}</Badge> : null}
        </div>
        <CardTitle className="text-2xl">
          {item.p75 === null ? "-" : formatVitalValue(item.metric, item.p75)}
        </CardTitle>
        <CardDescription>p75 · {item.count} samples</CardDescription>
      </CardHeader>
    </Card>
  );
}

function ChartPanel({
  className,
  description,
  option,
  title,
}: {
  className?: string;
  description: string;
  option: EChartsOption;
  title: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <EChart option={option} />
      </CardContent>
    </Card>
  );
}

function EChart({ option }: { option: EChartsOption }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = init(ref.current);
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, true);
    chartRef.current?.resize();
  }, [option]);

  return <div ref={ref} className="h-72 w-full min-w-0" />;
}

function RecentErrors({ items }: { items: TelemetryErrorEvent[] }) {
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
          <TableHead>路由</TableHead>
          <TableHead>错误</TableHead>
          <TableHead>Session</TableHead>
          <TableHead>Trace</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.slice(0, 10).map((item, index) => (
          // fingerprint+ts_server is not unique (identical errors batch at the
          // same millisecond); index is a safe tiebreaker for this read-only,
          // non-reordered list.
          <TableRow key={`${item.fingerprint}-${item.ts_server}-${index}`}>
            <TableCell className="whitespace-nowrap">
              {formatTime(item.ts_server)}
            </TableCell>
            <TableCell>
              <Badge variant="outline">{item.app}</Badge>
            </TableCell>
            <TableCell className="max-w-52 truncate">{item.route}</TableCell>
            <TableCell>
              <div className="max-w-96">
                <div className="truncate font-medium">{item.message}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {item.name}
                </div>
              </div>
            </TableCell>
            <TableCell>
              <InlineCode>{shortId(item.session_id)}</InlineCode>
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

function buildDashboardData(items: TelemetryErrorEvent[]): DashboardData {
  const sessions = new Set(items.map((item) => item.session_id));
  const traces = new Set(items.map((item) => item.trace_id).filter(Boolean));
  return {
    apps: topCounts(
      items.map((item) => item.app),
      8,
    ),
    errorsByHour: countsByHour(items),
    fingerprints: topCounts(
      items.map((item) => item.fingerprint),
      8,
    ),
    releases: topCounts(
      items.map((item) => item.release || "dev"),
      8,
    ),
    routes: topCounts(
      items.map((item) => item.route || "/"),
      8,
    ),
    sessionPoints: items
      .slice()
      .reverse()
      .map((item, index) => [new Date(item.ts_server).getTime(), index + 1]),
    sessions: sessions.size,
    traces: traces.size,
  };
}

function buildVitalSummaries(
  items: TelemetryPerformanceEvent[],
): VitalSummary[] {
  const metrics: VitalMetric[] = ["fcp", "lcp", "inp", "cls", "ttfb"];
  return metrics.map((metric) => {
    const values = items
      .filter((item) => item.metric === metric)
      .map((item) => item.value)
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);
    const p75 = percentile(values, 0.75);
    return {
      count: values.length,
      metric,
      p75,
      rating: p75 === null ? null : rateVital(metric, p75),
    };
  });
}

function percentile(values: number[], ratio: number): number | null {
  if (values.length === 0) return null;
  const index = Math.ceil(values.length * ratio) - 1;
  return values[Math.max(0, Math.min(index, values.length - 1))];
}

function formatVitalValue(metric: VitalMetric, value: number): string {
  if (metric === "cls") return value.toFixed(3);
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`;
  return `${Math.round(value)}ms`;
}

function rateVital(metric: VitalMetric, value: number): string {
  const thresholds: Record<VitalMetric, [number, number]> = {
    cls: [0.1, 0.25],
    fcp: [1800, 3000],
    inp: [200, 500],
    lcp: [2500, 4000],
    ttfb: [800, 1800],
  };
  const [good, poor] = thresholds[metric];
  if (value <= good) return "good";
  if (value <= poor) return "needs improvement";
  return "poor";
}

function topCounts(values: string[], limit: number): CountItem[] {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, value]) => ({ name, value }));
}

function countsByHour(items: TelemetryErrorEvent[]): CountItem[] {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    month: "2-digit",
  });
  const counts = new Map<string, number>();
  items.forEach((item) => {
    const key = formatter.format(new Date(item.ts_server));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, value]) => ({ name, value }));
}

function lineOption(title: string, data: CountItem[]): EChartsOption {
  return baseOption({
    grid: { bottom: 32, left: 36, right: 16, top: 24 },
    series: [
      {
        areaStyle: {},
        data: data.map((item) => item.value),
        name: title,
        smooth: true,
        type: "line",
      },
    ],
    tooltip: { trigger: "axis" },
    xAxis: { data: data.map((item) => item.name), type: "category" },
    yAxis: { minInterval: 1, type: "value" },
  });
}

function barOption(title: string, data: CountItem[]): EChartsOption {
  return baseOption({
    grid: { bottom: 28, left: 36, right: 16, top: 24 },
    series: [
      {
        data: data.map((item) => item.value),
        name: title,
        type: "bar",
      },
    ],
    tooltip: { trigger: "axis" },
    xAxis: {
      axisLabel: { hideOverlap: true, interval: 0, rotate: 25 },
      data: data.map((item) => item.name),
      type: "category",
    },
    yAxis: { minInterval: 1, type: "value" },
  });
}

function pieOption(title: string, data: CountItem[]): EChartsOption {
  return baseOption({
    legend: { bottom: 0, type: "scroll" },
    series: [
      {
        data,
        name: title,
        radius: ["45%", "70%"],
        type: "pie",
      },
    ],
    tooltip: { trigger: "item" },
  });
}

function scatterOption(points: [number, number][]): EChartsOption {
  return baseOption({
    grid: { bottom: 36, left: 36, right: 16, top: 20 },
    series: [
      {
        data: points,
        symbolSize: 10,
        type: "scatter",
      },
    ],
    tooltip: {
      trigger: "item",
      valueFormatter: (value) => String(value),
    },
    xAxis: { type: "time" },
    yAxis: { minInterval: 1, type: "value" },
  });
}

function baseOption(option: EChartsOption): EChartsOption {
  return {
    color: ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed"],
    textStyle: {
      fontFamily:
        'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
    ...option,
  };
}

export default HomePage;
