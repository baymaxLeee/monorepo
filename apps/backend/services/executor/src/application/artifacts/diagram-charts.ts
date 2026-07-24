export type DiagramChartSpec = {
  data?: unknown;
  layout?: unknown;
  orient?: unknown;
  nodes?: unknown;
  links?: unknown;
  tasks?: unknown;
};

export function expandDiagramChartSpec(
  type: string,
  input: DiagramChartSpec,
  title: Record<string, unknown>,
  palette: string[],
): Record<string, unknown> | null {
  if (type === "tree") return expandTreeChart(input, title, palette);
  if (type === "graph") return expandGraphChart(input, title, palette);
  if (type === "gantt") return expandGanttChart(input, title, palette);
  return null;
}

function chartText(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function expandTreeChart(
  input: DiagramChartSpec,
  title: Record<string, unknown>,
  palette: string[],
): Record<string, unknown> | null {
  const roots = normalizeTreeNodes(Array.isArray(input.data) ? input.data : [input.data], palette);
  if (!roots.length) return null;
  const layout = input.layout === "radial" ? "radial" : "orthogonal";
  const allowedOrient = new Set(["LR", "RL", "TB", "BT"]);
  const orient = typeof input.orient === "string" && allowedOrient.has(input.orient) ? input.orient : "LR";
  const vertical = orient === "TB" || orient === "BT";
  return {
    color: palette,
    ...title,
    tooltip: { trigger: "item", triggerOn: "mousemove" },
    series: [{
      type: "tree",
      data: roots,
      layout,
      orient,
      top: title.title ? 64 : "6%",
      left: "8%",
      right: "12%",
      bottom: "6%",
      roam: true,
      expandAndCollapse: true,
      initialTreeDepth: -1,
      symbol: vertical ? "roundRect" : "circle",
      symbolSize: vertical ? [108, 38] : 12,
      edgeShape: vertical ? "polyline" : "curve",
      label: vertical
        ? { position: "inside", color: "#fff", fontSize: 12, fontWeight: 600 }
        : { position: "left", verticalAlign: "middle", align: "right", color: "#334155", fontSize: 12 },
      leaves: vertical
        ? { label: { position: "inside", color: "#fff" } }
        : { label: { position: "right", verticalAlign: "middle", align: "left", color: "#334155" } },
      lineStyle: { color: "#94a3b8", width: 1.5, curveness: vertical ? 0 : 0.45 },
      emphasis: { focus: "descendant" },
    }],
  };
}

function normalizeTreeNodes(raw: unknown[], palette: string[]): Array<Record<string, unknown>> {
  let count = 0;
  const visit = (value: unknown, depth: number): Record<string, unknown> | null => {
    if (!value || typeof value !== "object" || Array.isArray(value) || depth > 10 || count >= 500) return null;
    const row = value as Record<string, unknown>;
    const name = chartText(row.name);
    if (!name) return null;
    count += 1;
    const children = Array.isArray(row.children)
      ? row.children.flatMap((child) => {
          const normalized = visit(child, depth + 1);
          return normalized ? [normalized] : [];
        })
      : [];
    return {
      name,
      value: typeof row.value === "number" || typeof row.value === "string" ? row.value : undefined,
      itemStyle: { color: palette[Math.min(depth, palette.length - 1)] },
      children: children.length ? children : undefined,
    };
  };
  return raw.flatMap((value) => {
    const normalized = visit(value, 0);
    return normalized ? [normalized] : [];
  });
}

function expandGraphChart(
  input: DiagramChartSpec,
  title: Record<string, unknown>,
  palette: string[],
): Record<string, unknown> | null {
  if (!Array.isArray(input.nodes) || !Array.isArray(input.links)) return null;
  const categories: string[] = [];
  const categoryIndexes = new Map<string, number>();
  const ids = new Set<string>();
  const nodes = input.nodes.slice(0, 500).flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    const id = chartText(row.id ?? row.name);
    const name = chartText(row.name ?? row.id);
    if (!id || !name || ids.has(id)) return [];
    ids.add(id);
    const category = chartText(row.category) || "默认";
    if (!categoryIndexes.has(category)) {
      categoryIndexes.set(category, categories.length);
      categories.push(category);
    }
    const categoryIndex = categoryIndexes.get(category) ?? 0;
    return [{
      id,
      name,
      value: typeof row.value === "number" || typeof row.value === "string" ? row.value : category,
      category: categoryIndex,
      symbolSize: typeof row.symbolSize === "number" && Number.isFinite(row.symbolSize)
        ? Math.max(24, Math.min(100, row.symbolSize))
        : 52,
      itemStyle: { color: palette[categoryIndex % palette.length], borderColor: "#fff", borderWidth: 2 },
    }];
  });
  if (!nodes.length) return null;
  const links = input.links.slice(0, 1_000).flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    const source = chartText(row.source);
    const target = chartText(row.target);
    if (!ids.has(source) || !ids.has(target) || source === target) return [];
    return [{ source, target, name: chartText(row.name) || undefined }];
  });
  const layout = input.layout === "circular" ? "circular" : "force";
  return {
    color: palette,
    ...title,
    tooltip: { trigger: "item" },
    legend: categories.length > 1 ? { data: categories, bottom: 0 } : undefined,
    series: [{
      type: "graph",
      layout,
      data: nodes,
      links,
      categories: categories.map((name) => ({ name })),
      roam: true,
      draggable: true,
      edgeSymbol: ["none", "arrow"],
      edgeSymbolSize: [0, 8],
      force: layout === "force" ? { repulsion: 360, edgeLength: [80, 150], gravity: 0.08 } : undefined,
      circular: layout === "circular" ? { rotateLabel: true } : undefined,
      label: { show: true, color: "#fff", fontSize: 11, fontWeight: 600 },
      lineStyle: { color: "source", width: 1.6, curveness: 0.12, opacity: 0.72 },
      emphasis: { focus: "adjacency", lineStyle: { width: 3, opacity: 1 } },
    }],
  };
}

function expandGanttChart(
  input: DiagramChartSpec,
  title: Record<string, unknown>,
  palette: string[],
): Record<string, unknown> | null {
  if (!Array.isArray(input.tasks)) return null;
  const stages = new Map<string, number>();
  const tasks = input.tasks.slice(0, 500).flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    const name = chartText(row.name);
    const start = typeof row.start === "number" ? row.start : Number(row.start);
    const end = typeof row.end === "number" ? row.end : Number(row.end);
    if (!name || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    const stage = chartText(row.stage) || "任务";
    if (!stages.has(stage)) stages.set(stage, stages.size);
    return [{ name, start, end, stage }];
  });
  if (!tasks.length) return null;
  const min = Math.min(...tasks.map((task) => task.start));
  const max = Math.max(...tasks.map((task) => task.end));
  return {
    color: palette,
    ...title,
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    grid: { left: 24, right: 28, top: title.title ? 60 : 24, bottom: 44, containLabel: true },
    xAxis: { type: "value", min, max, splitLine: { show: true, lineStyle: { type: "dashed" } } },
    yAxis: { type: "category", inverse: true, data: tasks.map((task) => task.name) },
    series: [
      {
        type: "bar",
        stack: "timeline",
        silent: true,
        itemStyle: { color: "transparent" },
        emphasis: { disabled: true },
        data: tasks.map((task) => task.start),
      },
      {
        name: "持续时间",
        type: "bar",
        stack: "timeline",
        barWidth: "58%",
        data: tasks.map((task) => ({
          value: task.end - task.start,
          name: `${task.name} · ${task.stage}`,
          itemStyle: { color: palette[(stages.get(task.stage) ?? 0) % palette.length], borderRadius: 4 },
        })),
      },
    ],
  };
}
