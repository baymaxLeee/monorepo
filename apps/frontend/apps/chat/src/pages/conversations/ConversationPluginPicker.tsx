import type { AgentPluginSelectionOption } from "@repo/api/admin";
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@repo/design-system";
import { Puzzle } from "lucide-react";

export function pluginUnavailableReason(option: AgentPluginSelectionOption, local: boolean) {
  if (option.requiresBindings) return "需要业务上下文";
  if (local && option.cloudOnly) return "仅限云端";
  return null;
}

export function ConversationPluginPicker({
  options,
  local,
  selected,
  onToggle,
  disabled,
}: {
  options: AgentPluginSelectionOption[];
  local: boolean;
  selected: string[];
  onToggle: (id: string, checked: boolean) => void;
  disabled: boolean;
}) {
  if (!options.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" variant="ghost" size="sm" disabled={disabled} aria-label="选择插件" />}
      >
        <Puzzle /> 插件{selected.length > 0 ? ` · ${selected.length}` : ""}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" aria-label="会话插件">
        {options.map((option) => {
          const reason = pluginUnavailableReason(option, local);
          return (
            <DropdownMenuCheckboxItem
              key={option.pluginId}
              checked={selected.includes(option.pluginId)}
              disabled={Boolean(reason)}
              onCheckedChange={(checked) => onToggle(option.pluginId, checked)}
            >
              <span>{option.displayName}</span>
              {reason && <span className="text-xs text-muted-foreground">{reason}</span>}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
