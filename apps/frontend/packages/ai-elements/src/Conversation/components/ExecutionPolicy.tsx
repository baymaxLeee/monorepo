import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@repo/design-system";
import { ShieldCheckIcon } from "lucide-react";

import { composerControlClassName } from "../../composer-control-styles";

export type ApprovalPolicyValue = "never" | "on-request" | "unless-trusted" | "granular";
export type PermissionProfileValue = ":read-only" | ":workspace" | ":danger-full-access";
export type AuthorizationMode = "ask-for-approval" | "approve-for-me" | "full-access";

export interface ExecutionPolicyValue {
  approvalPolicy: ApprovalPolicyValue;
  permissionProfile: PermissionProfileValue;
}

const authorizationModeLabels: Record<AuthorizationMode, string> = {
  "ask-for-approval": "请求批准",
  "approve-for-me": "帮我批准",
  "full-access": "完全访问",
};

const authorizationModePolicies: Record<AuthorizationMode, ExecutionPolicyValue> = {
  "ask-for-approval": { approvalPolicy: "on-request", permissionProfile: ":workspace" },
  "approve-for-me": { approvalPolicy: "granular", permissionProfile: ":workspace" },
  "full-access": { approvalPolicy: "never", permissionProfile: ":danger-full-access" },
};

export function authorizationModeFromExecutionPolicy(value: ExecutionPolicyValue): AuthorizationMode {
  if (value.approvalPolicy === "never" && value.permissionProfile === ":danger-full-access") {
    return "full-access";
  }
  if (value.approvalPolicy === "granular" && value.permissionProfile === ":workspace") {
    return "approve-for-me";
  }
  return "ask-for-approval";
}

export function executionPolicyForAuthorizationMode(mode: AuthorizationMode): ExecutionPolicyValue {
  return { ...authorizationModePolicies[mode] };
}

export function ExecutionPolicy({
  approvalPolicy,
  permissionProfile,
  onChange,
  disabled,
}: {
  approvalPolicy: ApprovalPolicyValue;
  permissionProfile: PermissionProfileValue;
  onChange?: (value: ExecutionPolicyValue) => void;
  disabled?: boolean;
}) {
  const locked = disabled || !onChange;
  const mode = authorizationModeFromExecutionPolicy({ approvalPolicy, permissionProfile });
  return (
    <Select
      value={mode}
      onValueChange={(next) => {
        if (next === "ask-for-approval" || next === "approve-for-me" || next === "full-access") {
          onChange?.(executionPolicyForAuthorizationMode(next));
        }
      }}
      disabled={locked}
    >
      <SelectTrigger
        aria-label="授权策略"
        size="sm"
        className={`h-7 rounded-full border-0 bg-transparent px-2.5 text-xs text-muted-foreground shadow-none hover:bg-muted hover:text-foreground aria-expanded:bg-muted data-[size=sm]:rounded-full ${composerControlClassName}`}
      >
        <ShieldCheckIcon className="size-4" />
        <SelectValue>{authorizationModeLabels[mode]}</SelectValue>
      </SelectTrigger>
      <SelectContent className="min-w-80">
        <SelectItem value="ask-for-approval">
          <span className="flex flex-col">
            <span>请求批准</span>
            <span className="text-xs text-muted-foreground">编辑工作区外文件和使用互联网时始终询问</span>
          </span>
        </SelectItem>
        <SelectItem value="approve-for-me">
          <span className="flex flex-col">
            <span>帮我批准</span>
            <span className="text-xs text-muted-foreground">仅对检测到的风险操作请求批准</span>
          </span>
        </SelectItem>
        <SelectItem value="full-access">
          <span className="flex flex-col">
            <span>完全访问</span>
            <span className="text-xs text-muted-foreground">可不受限制地访问互联网和运行环境中的任何文件</span>
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
