import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@repo/ai-elements";
import { Badge, Button } from "@repo/design-system";
import { BrainCircuitIcon, GaugeIcon, SparklesIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { composerControlClassName } from "../../composer-control-styles";

export interface ChatComposerControlsProps {
  models: ReadonlyArray<{ id: string; name: string; model?: string }>;
  selectedModelId: string | null;
  onSelectModel?: (id: string) => void;
  reasoningEffort?: ReasoningEffort;
  onReasoningEffortChange?: (effort: ReasoningEffort) => void;
  activatedSkillName?: string | null;
  onClearSkill?: () => void;
  disabled?: boolean;
}

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

const REASONING_OPTIONS: Array<{ id: ReasoningEffort; label: string }> = [
  { id: "none", label: "关闭推理" },
  { id: "minimal", label: "最少" },
  { id: "low", label: "低" },
  { id: "medium", label: "中" },
  { id: "high", label: "高" },
  { id: "xhigh", label: "很高" },
  { id: "max", label: "最高" },
];

export function ChatComposerControls({
  models,
  selectedModelId,
  onSelectModel,
  reasoningEffort,
  onReasoningEffortChange,
  activatedSkillName,
  onClearSkill,
  disabled,
}: ChatComposerControlsProps) {
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const options = models.map((model) => ({
    id: model.id,
    label: model.name,
    detail: model.model,
  }));
  const selectedLabel = options.find((option) => option.id === selectedModelId)?.label ?? "选择模型";
  const reasoningLabel = REASONING_OPTIONS.find((option) => option.id === reasoningEffort)?.label ?? "中";

  return (
    <>
      {onSelectModel ? (
        <ModelSelector open={selectorOpen} onOpenChange={setSelectorOpen}>
          <ModelSelectorTrigger
            render={
              <Button
                className={`h-8 max-w-72 justify-between gap-2 rounded-full px-2.5 text-xs text-muted-foreground hover:text-foreground ${composerControlClassName}`}
                disabled={options.length === 0 || disabled}
                type="button"
                variant="ghost"
              />
            }
          >
            <BrainCircuitIcon className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">{selectedLabel}</span>
          </ModelSelectorTrigger>
          <ModelSelectorContent title="选择推理模型">
            <ModelSelectorInput placeholder="搜索模型…" />
            <ModelSelectorList>
              <ModelSelectorEmpty>没有可用的推理模型</ModelSelectorEmpty>
              <ModelSelectorGroup>
                {options.map((option) => (
                  <ModelSelectorItem
                    key={option.id}
                    value={`${option.label} ${option.id}`}
                    data-checked={option.id === selectedModelId}
                    onSelect={() => {
                      onSelectModel(option.id);
                      setSelectorOpen(false);
                    }}
                  >
                    <ModelSelectorName>{option.label}</ModelSelectorName>
                    {option.detail ? <span className="text-xs text-muted-foreground">{option.detail}</span> : null}
                  </ModelSelectorItem>
                ))}
              </ModelSelectorGroup>
            </ModelSelectorList>
          </ModelSelectorContent>
        </ModelSelector>
      ) : (
        <span className="flex h-8 max-w-72 items-center gap-2 rounded-full px-2.5 text-xs text-muted-foreground">
          <BrainCircuitIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">{selectedLabel}</span>
        </span>
      )}
      {reasoningEffort ? (
        onReasoningEffortChange ? (
          <ModelSelector open={reasoningOpen} onOpenChange={setReasoningOpen}>
            <ModelSelectorTrigger
              render={
                <Button
                  className={`h-8 gap-2 rounded-full px-2.5 text-xs text-muted-foreground hover:text-foreground ${composerControlClassName}`}
                  disabled={disabled}
                  type="button"
                  variant="ghost"
                />
              }
            >
              <GaugeIcon className="size-3.5" aria-hidden="true" />
              推理：{reasoningLabel}
            </ModelSelectorTrigger>
            <ModelSelectorContent title="推理深度">
              <ModelSelectorList>
                <ModelSelectorGroup>
                  {REASONING_OPTIONS.map((option) => (
                    <ModelSelectorItem
                      key={option.id}
                      value={option.label}
                      data-checked={option.id === reasoningEffort}
                      onSelect={() => {
                        onReasoningEffortChange(option.id);
                        setReasoningOpen(false);
                      }}
                    >
                      <ModelSelectorName>{option.label}</ModelSelectorName>
                    </ModelSelectorItem>
                  ))}
                </ModelSelectorGroup>
              </ModelSelectorList>
            </ModelSelectorContent>
          </ModelSelector>
        ) : (
          <span className="flex h-8 items-center gap-2 rounded-full px-2.5 text-xs text-muted-foreground">
            <GaugeIcon className="size-3.5" aria-hidden="true" />
            推理：{reasoningLabel}
          </span>
        )
      ) : null}
      {activatedSkillName ? (
        <Badge variant="secondary" className="h-8 gap-1 rounded-full pl-2.5 pr-1.5">
          <SparklesIcon className="size-3.5" />
          <span className="font-mono text-xs">{activatedSkillName}</span>
          <button
            type="button"
            aria-label="取消技能"
            className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
            onClick={onClearSkill}
          >
            <XIcon className="size-3" />
          </button>
        </Badge>
      ) : null}
    </>
  );
}
