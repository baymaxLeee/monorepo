import type { AgentPluginSelectionOption } from "@repo/api/admin";
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@repo/design-system";
import { BlocksIcon } from "lucide-react";

export function PluginPicker({
  disabled,
  onChange,
  plugins,
  selected,
}: {
  disabled?: boolean;
  onChange: (pluginIds: string[]) => void;
  plugins: AgentPluginSelectionOption[];
  selected: string[];
}) {
  const selectedSet = new Set(selected);
  const label = selected.length > 0 ? `插件 ${selected.length}` : "插件";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label="选择插件"
            className="h-8 gap-2 rounded-full px-2.5 text-xs text-muted-foreground hover:text-foreground"
            disabled={disabled || plugins.length === 0}
            type="button"
            variant="ghost"
          />
        }
      >
        <BlocksIcon className="size-3.5" aria-hidden="true" />
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72" align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel>当前会话可用插件</DropdownMenuLabel>
          {plugins.map((plugin) =>
            plugin.requiresBindings ? (
              <DropdownMenuItem key={plugin.pluginId} disabled>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{plugin.displayName}</span>
                  <span className="block truncate text-xs text-muted-foreground">需从对应业务上下文启用</span>
                </span>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuCheckboxItem
                key={plugin.pluginId}
                checked={selectedSet.has(plugin.pluginId)}
                closeOnClick={false}
                onCheckedChange={(checked) => {
                  const next = checked
                    ? [...selectedSet, plugin.pluginId]
                    : [...selectedSet].filter((id) => id !== plugin.pluginId);
                  onChange(next.sort());
                }}
              >
                <span className="min-w-0">
                  <span className="block truncate">{plugin.displayName}</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">{plugin.pluginId}</span>
                </span>
              </DropdownMenuCheckboxItem>
            ),
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
