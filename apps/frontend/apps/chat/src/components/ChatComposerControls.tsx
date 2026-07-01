import type { ModelProvider } from "api";
import { Button, Switch } from "components";
import { ModelSelector } from "components/ai-chat";
import { BotIcon, BrainIcon, ListChecksIcon } from "lucide-react";

export interface ChatComposerControlsProps {
  providers: ModelProvider[];
  selectedProviderId: string | null;
  onSelectProvider: (id: string) => void;
  thinking: boolean;
  onThinkingChange: (next: boolean) => void;
  disabled?: boolean;
  mode: "normal" | "plan";
  onModeChange: (mode: "normal" | "plan") => void;
}

export function ChatComposerControls({
  providers,
  selectedProviderId,
  onSelectProvider,
  thinking,
  onThinkingChange,
  disabled,
  mode,
  onModeChange,
}: ChatComposerControlsProps) {
  const options = providers
    .filter((provider) => provider.is_enabled)
    .map((provider) => ({
      id: provider.id,
      label: provider.name,
      description: provider.model,
      badge: provider.is_default ? "默认" : undefined,
    }));

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 rounded-full px-2.5 text-xs text-muted-foreground hover:text-foreground"
        disabled={disabled}
        onClick={() => onModeChange(mode === "plan" ? "normal" : "plan")}
      >
        {mode === "plan" ? (
          <ListChecksIcon className="size-3.5" />
        ) : (
          <BotIcon className="size-3.5" />
        )}
        {mode === "plan" ? "Plan" : "Agent"}
      </Button>
      <ModelSelector
        value={selectedProviderId}
        options={options}
        onValueChange={onSelectProvider}
        placeholder="选择模型"
        disabled={disabled || options.length === 0}
      />
      <span className="flex items-center gap-1.5 rounded-full px-2 text-xs text-muted-foreground">
        <BrainIcon className="size-3.5" />
        <span>思考</span>
        <Switch
          checked={thinking}
          onCheckedChange={onThinkingChange}
          disabled={disabled}
          aria-label="切换思考模式"
        />
      </span>
    </>
  );
}
