import type { ComponentProps } from "react";
import { cn } from "shared";
import { Button } from "../shadcn/button";
import { Popover, PopoverContent, PopoverTrigger } from "../shadcn/popover";

const RADIUS = 10;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export type ContextUsageCategoryId =
  | "system"
  | "tools"
  | "rules"
  | "skills"
  | "mcp"
  | "memory"
  | "conversation";

export interface ContextUsageCategory {
  id: ContextUsageCategoryId;
  tokens: number;
  shareOfUsed: number;
  shareOfEffectiveWindow: number | null;
}

const CATEGORY_META: Record<
  ContextUsageCategoryId,
  { label: string; color: string }
> = {
  system: { label: "System prompt", color: "bg-zinc-400" },
  tools: { label: "Tool definitions", color: "bg-purple-400" },
  rules: { label: "Rules", color: "bg-green-400" },
  skills: { label: "Skills", color: "bg-yellow-500" },
  mcp: { label: "MCP & dynamic tools", color: "bg-fuchsia-500" },
  memory: { label: "Memory", color: "bg-blue-500" },
  conversation: { label: "Conversation", color: "bg-orange-500" },
};

function compactTokens(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    notation: "compact",
  }).format(value);
}

export type ContextUsageProps = ComponentProps<typeof Popover> & {
  usedTokens?: number | null;
  maxTokens?: number | null;
  contextWindow?: number | null;
  reservedOutputTokens?: number | null;
  reservedOverheadTokens?: number | null;
  utilization?: number | null;
  categories?: ContextUsageCategory[];
  cachedInputTokens?: number | null;
  model?: string | null;
  loading?: boolean;
  totalEstimated?: boolean;
  breakdownEstimated?: boolean;
};

export function ContextUsage({
  usedTokens,
  maxTokens,
  contextWindow,
  reservedOutputTokens,
  reservedOverheadTokens,
  utilization,
  categories = [],
  cachedInputTokens,
  model,
  loading,
  totalEstimated,
  breakdownEstimated,
  ...props
}: ContextUsageProps) {
  const hasUsage = usedTokens != null;
  const fraction =
    utilization != null ? Math.min(1, Math.max(0, utilization)) : 0;
  const percent = utilization != null ? Math.round(utilization * 100) : null;
  const visibleCategories = categories.filter(
    (category) => category.tokens > 0,
  );
  const ringClass =
    fraction >= 0.9
      ? "text-destructive"
      : fraction >= 0.7
        ? "text-amber-500"
        : "text-muted-foreground";

  return (
    <Popover {...props}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="rounded-full"
          aria-label={
            percent != null ? `上下文已使用 ${percent}%` : "查看上下文用量"
          }
        >
          <svg
            aria-hidden="true"
            className={cn(
              "size-5 -rotate-90",
              ringClass,
              loading && "animate-pulse",
            )}
            viewBox="0 0 24 24"
          >
            <circle
              cx="12"
              cy="12"
              r={RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              opacity="0.25"
            />
            <circle
              cx="12"
              cy="12"
              r={RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              opacity="0.7"
              strokeDasharray={
                hasUsage && utilization == null ? "2 4" : CIRCUMFERENCE
              }
              strokeDashoffset={
                hasUsage && utilization == null
                  ? 0
                  : CIRCUMFERENCE * (1 - fraction)
              }
            />
          </svg>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        className="w-[calc(100vw-2rem)] max-w-[420px] space-y-4 p-5"
      >
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-base font-medium">Context Usage</h3>
            <span className="text-sm text-muted-foreground">
              {percent != null
                ? `${percent}% Full`
                : hasUsage
                  ? "上限未知"
                  : "暂无数据"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
            <span className="truncate">{model ?? "尚未调用模型"}</span>
            {hasUsage ? (
              <span className="shrink-0 font-mono">
                ~{compactTokens(usedTokens)} / {compactTokens(maxTokens)}{" "}
                effective tokens
              </span>
            ) : null}
          </div>
        </div>

        {hasUsage ? (
          <>
            <div className="flex h-2 overflow-hidden rounded-full bg-muted">
              {visibleCategories.map((category) => (
                <span
                  key={category.id}
                  className={cn("h-full", CATEGORY_META[category.id].color)}
                  style={{
                    width: `${Math.min(
                      100,
                      (category.shareOfEffectiveWindow ??
                        category.shareOfUsed) * 100,
                    )}%`,
                  }}
                />
              ))}
            </div>
            <div className="grid gap-1">
              {visibleCategories.map((category) => (
                <ContextUsageRow key={category.id} category={category} />
              ))}
            </div>
            <div className="space-y-1 border-t pt-3 text-[11px] leading-relaxed text-muted-foreground">
              {cachedInputTokens != null ? (
                <p>
                  Provider cache hit: {compactTokens(cachedInputTokens)} tokens
                </p>
              ) : null}
              {contextWindow != null ? (
                <p>
                  Full window: {compactTokens(contextWindow)}; output reserve:{" "}
                  {compactTokens(reservedOutputTokens)}; safety headroom:{" "}
                  {compactTokens(reservedOverheadTokens)}.
                </p>
              ) : null}
              <p>
                总占用
                {totalEstimated ? "为请求内容估算" : "使用 provider 实际 usage"}
                ；类别拆分
                {breakdownEstimated
                  ? "按实际请求内容估算并校准"
                  : "来自上下文快照"}
                。
              </p>
            </div>
          </>
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">
            发送一条消息后，这里会显示该会话送入模型的统一上下文快照。
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ContextUsageRow({ category }: { category: ContextUsageCategory }) {
  const meta = CATEGORY_META[category.id];
  return (
    <div className="flex items-center justify-between gap-4 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60">
      <span className="flex items-center gap-3 text-muted-foreground">
        <span className={cn("size-3 rounded-sm", meta.color)} />
        {meta.label}
      </span>
      <span className="font-mono text-muted-foreground">
        {compactTokens(category.tokens)}
      </span>
    </div>
  );
}
