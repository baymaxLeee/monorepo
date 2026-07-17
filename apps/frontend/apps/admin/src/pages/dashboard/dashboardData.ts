import type { TelemetryErrorEvent, TelemetryPerformanceEvent } from "api";
import type { EChartsOption } from "echarts";

export type CountItem = {
  name: string;
  value: number;
};

export type DashboardData = {
  apps: CountItem[];
  errorsByHour: CountItem[];
  fingerprints: CountItem[];
  releases: CountItem[];
  routes: CountItem[];
  sessionPoints: [number, number][];
  sessions: number;
  traces: number;
};

export type VitalMetric = "fcp" | "lcp" | "inp" | "cls" | "ttfb";

export type VitalSummary = {
  count: number;
  metric: VitalMetric;
  p75: number | null;
  rating: string | null;
};

export const VITAL_LABELS: Record<VitalMetric, string> = {
  cls: "CLS",
  fcp: "FCP",
  inp: "INP",
  lcp: "LCP",
  ttfb: "TTFB",
};

export function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

export function shortId(value: string | null) {
  return value ? value.slice(0, 10) : "-";
}

export function buildDashboardData(
  items: TelemetryErrorEvent[],
): DashboardData {
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

export function buildVitalSummaries(
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

export function formatVitalValue(metric: VitalMetric, value: number): string {
  if (metric === "cls") return value.toFixed(3);
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`;
  return `${Math.round(value)}ms`;
}

export function lineOption(title: string, data: CountItem[]): EChartsOption {
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

export function barOption(title: string, data: CountItem[]): EChartsOption {
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

export function pieOption(title: string, data: CountItem[]): EChartsOption {
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

export function scatterOption(points: [number, number][]): EChartsOption {
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

function percentile(values: number[], ratio: number): number | null {
  if (values.length === 0) return null;
  const index = Math.ceil(values.length * ratio) - 1;
  return values[Math.max(0, Math.min(index, values.length - 1))];
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
  values.forEach((value) => {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });
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
