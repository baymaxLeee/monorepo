import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
} from "@repo/design-system";
import { CheckIcon, ZapIcon } from "lucide-react";
import { useState } from "react";

import { composerControlClassName } from "../../composer-control-styles";

export interface ChatComposerControlsProps {
  models: ReadonlyArray<{ id: string; name: string; model?: string }>;
  selectedModelId: string | null;
  onSelectModel?: (id: string) => void;
  reasoningEffort?: ReasoningEffort;
  onReasoningEffortChange?: (effort: ReasoningEffort) => void;
  disabled?: boolean;
}

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

const REASONING_OPTIONS: Array<{ id: ReasoningEffort; label: string }> = [
  { id: "none", label: "关闭" },
  { id: "minimal", label: "最低" },
  { id: "low", label: "低" },
  { id: "medium", label: "中" },
  { id: "high", label: "高" },
  { id: "xhigh", label: "极高" },
  { id: "max", label: "最高" },
];

export function ChatComposerControls({
  models,
  selectedModelId,
  onSelectModel,
  reasoningEffort,
  onReasoningEffortChange,
  disabled,
}: ChatComposerControlsProps) {
  const [open, setOpen] = useState(false);
  const selectedModel = models.find((model) => model.id === selectedModelId);
  const selectedModelLabel = selectedModel?.name ?? "选择模型";
  const reasoningLabel = REASONING_OPTIONS.find((option) => option.id === reasoningEffort)?.label;
  const triggerContent = (
    <>
      <ZapIcon className="size-3.5 shrink-0 fill-current" aria-hidden="true" />
      <span className="min-w-0 truncate text-foreground">{selectedModelLabel}</span>
      {reasoningLabel ? <span className="shrink-0 text-muted-foreground">{reasoningLabel}</span> : null}
    </>
  );

  if (!onSelectModel && !onReasoningEffortChange) {
    return <span className="flex h-8 max-w-80 items-center gap-2 rounded-full px-2.5 text-xs">{triggerContent}</span>;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="模型与推理强度"
            className={`h-8 max-w-80 gap-2 rounded-full px-2.5 text-xs ${composerControlClassName}`}
            disabled={disabled || models.length === 0}
          />
        }
      >
        {triggerContent}
      </PopoverTrigger>
      <PopoverContent side="top" sideOffset={8} align="end" className="w-80 p-2">
        <div className="px-2 pt-1 pb-2 text-xs font-medium text-muted-foreground">模型</div>
        <Command>
          <CommandInput placeholder="搜索模型…" />
          <CommandList className="max-h-48">
            <CommandEmpty>没有可用的推理模型</CommandEmpty>
            <CommandGroup>
              {models.map((model) => (
                <CommandItem
                  key={model.id}
                  value={`${model.name} ${model.model ?? ""} ${model.id}`}
                  aria-label={model.name}
                  disabled={!onSelectModel}
                  onSelect={() => onSelectModel?.(model.id)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{model.name}</span>
                    {model.model && model.model !== model.name ? (
                      <span className="block truncate text-xs text-muted-foreground">{model.model}</span>
                    ) : null}
                  </span>
                  {model.id === selectedModelId ? <CheckIcon className="size-4 shrink-0" aria-hidden="true" /> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {reasoningEffort ? (
          <>
            <Separator className="my-2" />
            <div className="px-2 pt-1 pb-2 text-xs font-medium text-muted-foreground">推理强度</div>
            <div className="flex flex-wrap gap-1 px-1 pb-1">
              {REASONING_OPTIONS.map((option) => (
                <Button
                  key={option.id}
                  type="button"
                  variant={option.id === reasoningEffort ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 flex-1 px-2 text-xs"
                  aria-label={option.label}
                  disabled={!onReasoningEffortChange}
                  onClick={() => onReasoningEffortChange?.(option.id)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
