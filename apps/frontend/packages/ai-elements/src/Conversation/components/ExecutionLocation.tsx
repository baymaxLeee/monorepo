import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@repo/design-system";
import { CloudIcon, MonitorIcon } from "lucide-react";

import { composerControlClassName } from "../../composer-control-styles";

export function ExecutionLocation({
  value,
  onChange,
  localAvailable,
  disabled,
  localLabel = "本地电脑",
}: {
  value: "cloud" | "local";
  onChange?: (value: "cloud" | "local") => void;
  localAvailable: boolean;
  disabled?: boolean;
  localLabel?: string;
}) {
  const Icon = value === "local" ? MonitorIcon : CloudIcon;
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next === "cloud" || next === "local") onChange?.(next);
      }}
      disabled={disabled || !onChange}
    >
      <SelectTrigger
        aria-label="执行位置"
        size="sm"
        className={`border-0 bg-transparent shadow-none ${composerControlClassName}`}
      >
        <Icon className="size-4" />
        <SelectValue>{value === "local" ? localLabel : "云端"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="cloud">云端</SelectItem>
        <SelectItem value="local" disabled={!localAvailable}>
          本地电脑
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
