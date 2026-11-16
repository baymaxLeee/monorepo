import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@repo/design-system";
import { ShieldCheckIcon } from "lucide-react";

import { composerControlClassName } from "../../composer-control-styles";

export type ApprovalModeValue = "request" | "auto" | "full";

const labels: Record<ApprovalModeValue, string> = {
  request: "请求批准",
  auto: "帮我批准",
  full: "完全访问权限",
};

export function ApprovalMode({
  value,
  onChange,
  disabled,
}: {
  value: ApprovalModeValue;
  onChange?: (value: ApprovalModeValue) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next === "request" || next === "auto" || next === "full") onChange?.(next);
      }}
      disabled={disabled || !onChange}
    >
      <SelectTrigger
        aria-label="本地授权策略"
        size="sm"
        className={`border-0 bg-transparent shadow-none ${composerControlClassName}`}
      >
        <ShieldCheckIcon className="size-4" />
        <SelectValue>{labels[value]}</SelectValue>
      </SelectTrigger>
      <SelectContent className="min-w-80">
        <SelectItem value="request">
          <span className="flex flex-col">
            <span>请求批准</span>
            <span className="text-xs text-muted-foreground">使用网络或执行有副作用的命令前询问</span>
          </span>
        </SelectItem>
        <SelectItem value="auto">
          <span className="flex flex-col">
            <span>帮我批准</span>
            <span className="text-xs text-muted-foreground">仅对检测到的敏感操作请求批准</span>
          </span>
        </SelectItem>
        <SelectItem value="full">
          <span className="flex flex-col">
            <span>完全访问权限</span>
            <span className="text-xs text-muted-foreground">常规操作无需询问，仍限制在授权目录</span>
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
