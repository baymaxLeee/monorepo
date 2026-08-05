import type { TelemetryErrorEvent } from "@repo/api";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  InlineCode,
  Skeleton,
} from "@repo/design-system";
import type { EChartsOption } from "echarts";
import { BarChart, LineChart, PieChart, ScatterChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { type EChartsType, init, use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

import {
  barOption,
  type DashboardData,
  formatVitalValue,
  lineOption,
  pieOption,
  scatterOption,
  VITAL_LABELS,
  type VitalSummary,
} from "./dashboardData";
import { RecentErrors } from "./DashboardRecentErrors";

use([BarChart, CanvasRenderer, GridComponent, LegendComponent, LineChart, PieChart, ScatterChart, TooltipComponent]);

type DashboardContentProps = {
  data: DashboardData;
  items: TelemetryErrorEvent[];
  loading: boolean;
  vitals: VitalSummary[];
};

export function DashboardContent({ data, items, loading, vitals }: DashboardContentProps) {
  return (
    <>
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
    </>
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
        <CardTitle className="text-2xl">{item.p75 === null ? "-" : formatVitalValue(item.metric, item.p75)}</CardTitle>
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
    if (!ref.current) {
      return;
    }
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
