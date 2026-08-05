import { ModelSelector } from "@repo/ai-elements";
import type { Bot } from "@repo/api";
import { Badge, Button } from "@repo/design-system";
import { BotIcon, ListChecksIcon, SparklesIcon, XIcon } from "lucide-react";

export interface ChatComposerControlsProps {
  agents: Bot[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  activatedSkillName?: string | null;
  onClearSkill?: () => void;
  disabled?: boolean;
  mode: "normal" | "plan";
  onModeChange: (mode: "normal" | "plan") => void;
}

export function ChatComposerControls({
  agents,
  selectedAgentId,
  onSelectAgent,
  activatedSkillName,
  onClearSkill,
  disabled,
  mode,
  onModeChange,
}: ChatComposerControlsProps) {
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
        {mode === "plan" ? <ListChecksIcon className="size-3.5" /> : <BotIcon className="size-3.5" />}
        {mode === "plan" ? "Plan" : "Agent"}
      </Button>
      <ModelSelector
        value={selectedAgentId}
        options={options}
        onValueChange={onSelectAgent}
        placeholder="选择智能体"
        disabled={options.length === 0}
      />
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
