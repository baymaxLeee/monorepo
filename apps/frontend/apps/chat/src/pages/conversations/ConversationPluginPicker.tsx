import type { AgentPluginSelectionOption } from "@repo/api/admin";
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/design-system";
import type { InstalledLocalPlugin } from "@repo/runtime/desktop";
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
  installed,
  selectedLocal,
  onToggleLocal,
  onImport,
}: {
  installed: InstalledLocalPlugin[];
  selectedLocal: string[];
  onToggleLocal: (id: string, checked: boolean) => void;
  onImport: () => void;
  options: AgentPluginSelectionOption[];
  local: boolean;
  selected: string[];
  onToggle: (id: string, checked: boolean) => void;
  disabled: boolean;
}) {
  if (!local && !options.length) return null;
  const count = selected.length + (local ? selectedLocal.length : 0);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" variant="ghost" size="sm" disabled={disabled} aria-label="选择插件" />}
      >
        <Puzzle /> 插件{count > 0 ? ` · ${count}` : ""}
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
        {local && (
          <>
            {options.length > 0 && <DropdownMenuSeparator />}
            {installed.map((plugin) => (
              <DropdownMenuCheckboxItem
                key={plugin.pluginId}
                checked={selectedLocal.includes(plugin.pluginId)}
                onCheckedChange={(checked) => onToggleLocal(plugin.pluginId, checked)}
              >
                <span>{plugin.displayName}</span>
                <span className="text-xs text-muted-foreground">本机</span>
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuItem onClick={onImport}>导入本地插件…</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
