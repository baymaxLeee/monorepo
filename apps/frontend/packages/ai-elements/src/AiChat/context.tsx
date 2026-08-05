import { Button } from "@repo/design-system/shadcn/button";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/design-system/shadcn/popover";
import { cn } from "@repo/shared";
import type { ComponentProps } from "react";

const RADIUS = 10;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export type ContextUsageCategoryId = "system" | "tools" | "rules" | "skills" | "mcp" | "memory" | "conversation";

export interface ContextUsageCategory {
  id: ContextUsageCategoryId;
  tokens: number;
}

const CATEGORY_META: Record<ContextUsageCategoryId, { label: string; color: string }> = {
  system: { label: "System prompt", color: "bg-zinc-400" },
  tools: { label: "Tool definitions", color: "bg-purple-400" },
  rules: { label: "Rules", color: "bg-green-400" },
  skills: { label: "Skills", color: "bg-yellow-500" },
  mcp: { label: "MCP & dynamic tools", color: "bg-fuchsia-500" },
  memory: { label: "Memory", color: "bg-blue-500" },
  conversation: { label: "Conversation", color: "bg-orange-500" },
};

const TOKENS_PER_K = 1024;

function formatTokens(value: number | null | undefined) {
  if (value == null) {
    return "—";
  }
  if (value < TOKENS_PER_K) {
    return String(value);
  }
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    useGrouping: false,
  }).format(value / TOKENS_PER_K)}K`;
}

export interface ContextUsageValue {
  usedTokens: number;
  contextWindow: number | null;
  categories: ContextUsageCategory[];
}

export type ContextUsageProps = ComponentProps<typeof Popover> & {
  value?: ContextUsageValue | null;
  loading?: boolean;
};

export function ContextUsage({ value, loading, ...props }: ContextUsageProps) {
  const hasUsage = value != null;
  const usedTokens = value?.usedTokens;
  const contextWindow = value?.contextWindow;
  const utilization =
    usedTokens != null && contextWindow != null && contextWindow > 0 ? usedTokens / contextWindow : null;
  const fraction = utilization != null ? Math.min(1, Math.max(0, utilization)) : 0;
  const percent = utilization != null ? Math.round(utilization * 100) : null;
  const visibleCategories = (value?.categories ?? []).filter((category) => category.tokens > 0);
  const categoryDenominator = contextWindow != null && contextWindow > 0 ? contextWindow : usedTokens;
  const ringClass = fraction >= 0.9 ? "text-destructive" : fraction >= 0.7 ? "text-amber-500" : "text-muted-foreground";

  return (
    <Popover {...props}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="rounded-full"
          aria-label={percent != null ? `上下文已使用 ${percent}%` : "查看上下文用量"}
        >
          <svg
            aria-hidden="true"
            className={cn("size-5 -rotate-90", ringClass, loading && "animate-pulse")}
            viewBox="0 0 24 24"
          >
            <circle cx="12" cy="12" r={RADIUS} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.25" />
            <circle
              cx="12"
              cy="12"
              r={RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              opacity="0.7"
              strokeDasharray={hasUsage && utilization == null ? "2 4" : CIRCUMFERENCE}
              strokeDashoffset={hasUsage && utilization == null ? 0 : CIRCUMFERENCE * (1 - fraction)}
            />
          </svg>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="center" side="top" className="w-72 space-y-2.5 p-3">
        <h3 className="text-sm font-medium">Context Usage</h3>

        {hasUsage ? (
          <>
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>{percent != null ? `${percent}% Full` : "上限未知"}</span>
              <span className="shrink-0 tabular-nums">
                ~{formatTokens(usedTokens)} / {formatTokens(contextWindow)} Tokens
              </span>
            </div>
            <div className="flex h-1 overflow-hidden rounded-full bg-muted">
              {visibleCategories.map((category) => (
                <span
                  key={category.id}
                  className={cn("h-full", CATEGORY_META[category.id].color)}
                  style={{
                    width: `${
                      categoryDenominator && categoryDenominator > 0
                        ? Math.min(100, (category.tokens / categoryDenominator) * 100)
                        : 0
                    }%`,
                  }}
                />
              ))}
            </div>
            <div className="grid gap-0.5">
              {visibleCategories.map((category) => (
                <ContextUsageRow key={category.id} category={category} />
              ))}
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">{percent != null ? `${percent}% Full` : "暂无数据"}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ContextUsageRow({ category }: { category: ContextUsageCategory }) {
  const meta = CATEGORY_META[category.id];
  return (
    <div className="flex items-center justify-between gap-3 py-0.5 text-xs">
      <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
        <span className={cn("size-2 shrink-0 rounded-sm", meta.color)} />
        <span className="truncate">{meta.label}</span>
      </span>
      <span className="shrink-0 tabular-nums text-muted-foreground">{formatTokens(category.tokens)}</span>
    </div>
  );
}
