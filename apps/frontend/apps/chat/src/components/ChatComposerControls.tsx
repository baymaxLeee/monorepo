import type { Bot } from "api";
import { Button, Switch } from "components";
import { ModelSelector } from "components/ai-chat";
import { BotIcon, BrainIcon, ListChecksIcon } from "lucide-react";

export interface ChatComposerControlsProps {
  agents: Bot[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  thinking: boolean;
  onThinkingChange: (next: boolean) => void;
  disabled?: boolean;
  mode: "normal" | "plan";
  onModeChange: (mode: "normal" | "plan") => void;
}

export function ChatComposerControls({
  agents,
  selectedAgentId,
  onSelectAgent,
  thinking,
  onThinkingChange,
  disabled,
  mode,
  onModeChange,
}: ChatComposerControlsProps) {
  // One agent bundles the text/image/video models a run uses; picking an agent
  // replaces per-model selection (configured in admin → 智能体).
  const options = agents.map((agent) => ({
    id: agent.id,
    label: agent.name,
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
        value={selectedAgentId}
        options={options}
        onValueChange={onSelectAgent}
        placeholder="选择智能体"
        disabled={options.length === 0}
      />
      <span className="flex items-center gap-1.5 rounded-full px-2 text-xs text-muted-foreground">
        <BrainIcon className="size-3.5" />
        <span>思考</span>
        <Switch
          checked={thinking}
          onCheckedChange={onThinkingChange}
          aria-label="切换思考模式"
        />
      </span>
    </>
  );
}
