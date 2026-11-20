import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@repo/design-system";
import { ShieldCheckIcon, ShieldIcon } from "lucide-react";

import { composerControlClassName } from "../../composer-control-styles";

export type ApprovalPolicyValue = "never" | "on-request" | "unless-trusted" | "granular";
export type PermissionProfileValue = ":read-only" | ":workspace" | ":danger-full-access";

const approvalLabels: Record<ApprovalPolicyValue, string> = {
  never: "从不询问",
  "on-request": "按需询问",
  "unless-trusted": "未信任时询问",
  granular: "精细审批",
};
const profileLabels: Record<PermissionProfileValue, string> = {
  ":read-only": "只读",
  ":workspace": "工作区",
  ":danger-full-access": "无限制",
};

export function ExecutionPolicy({
  approvalPolicy,
  permissionProfile,
  onChange,
  disabled,
}: {
  approvalPolicy: ApprovalPolicyValue;
  permissionProfile: PermissionProfileValue;
  onChange?: (value: { approvalPolicy: ApprovalPolicyValue; permissionProfile: PermissionProfileValue }) => void;
  disabled?: boolean;
}) {
  const locked = disabled || !onChange;
  return (
    <>
      <Select
        value={permissionProfile}
        onValueChange={(next) => {
          if (next === ":read-only" || next === ":workspace" || next === ":danger-full-access") {
            onChange?.({ approvalPolicy, permissionProfile: next });
          }
        }}
        disabled={locked}
      >
        <SelectTrigger
          aria-label="命令权限范围"
          size="sm"
          className={`border-0 bg-transparent shadow-none ${composerControlClassName}`}
        >
          <ShieldIcon className="size-4" />
          <SelectValue>{profileLabels[permissionProfile]}</SelectValue>
        </SelectTrigger>
        <SelectContent className="min-w-80">
          <SelectItem value=":read-only">
            <span className="flex flex-col">
              <span>只读</span>
              <span className="text-xs text-muted-foreground">可读取工作区，不允许写入或默认联网</span>
            </span>
          </SelectItem>
          <SelectItem value=":workspace">
            <span className="flex flex-col">
              <span>工作区</span>
              <span className="text-xs text-muted-foreground">可写授权项目；工作区外只读，网络受控</span>
            </span>
          </SelectItem>
          <SelectItem value=":danger-full-access">
            <span className="flex flex-col">
              <span>无限制</span>
              <span className="text-xs text-muted-foreground">停用命令 sandbox；危险操作仍受 exec policy 约束</span>
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={approvalPolicy}
        onValueChange={(next) => {
          if (next === "never" || next === "on-request" || next === "unless-trusted" || next === "granular") {
            onChange?.({ approvalPolicy: next, permissionProfile });
          }
        }}
        disabled={locked}
      >
        <SelectTrigger
          aria-label="命令审批策略"
          size="sm"
          className={`border-0 bg-transparent shadow-none ${composerControlClassName}`}
        >
          <ShieldCheckIcon className="size-4" />
          <SelectValue>{approvalLabels[approvalPolicy]}</SelectValue>
        </SelectTrigger>
        <SelectContent className="min-w-80">
          <SelectItem value="never">
            <span className="flex flex-col">
              <span>从不询问</span>
              <span className="text-xs text-muted-foreground">不能自动放行的操作直接拒绝</span>
            </span>
          </SelectItem>
          <SelectItem value="on-request">
            <span className="flex flex-col">
              <span>按需询问</span>
              <span className="text-xs text-muted-foreground">sandbox 内常规命令直接运行，扩大权限时询问</span>
            </span>
          </SelectItem>
          <SelectItem value="unless-trusted">
            <span className="flex flex-col">
              <span>未信任时询问</span>
              <span className="text-xs text-muted-foreground">未由策略明确允许的命令都需要确认</span>
            </span>
          </SelectItem>
          <SelectItem value="granular">
            <span className="flex flex-col">
              <span>精细审批</span>
              <span className="text-xs text-muted-foreground">分别执行 policy 自动决策与强制人工确认</span>
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
    </>
  );
}
