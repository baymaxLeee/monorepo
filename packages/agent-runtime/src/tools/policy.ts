import type { InferToolSetContext } from "@ai-sdk/provider-utils";
import type { GenericToolApprovalFunction, ToolSet } from "ai";

import type { ApprovalMode } from "../agent/types.js";
import { toolPolicyFromMetadata } from "./manifest.js";

const NETWORK_COMMAND =
  /(?:^|[;&|\s])(curl|wget|ssh|scp|sftp|ftp|nc|ncat|telnet|git\s+(?:clone|fetch|pull|push)|(?:npm|pnpm|yarn|bun|pip|uv|cargo|go)\s+(?:add|install|get|publish))(?:\s|$)/iu;
const SENSITIVE_COMMAND =
  /(?:^|[;&|\s])(sudo|su|rm\s+(?:-[^\s]*[rRf][^\s]*|--recursive|--force)|git\s+(?:reset\s+--hard|clean\s+-|push\s+.*--force)|chmod|chown|kill|pkill|killall|launchctl|defaults\s+write|security\s+|dd\s+|mkfs|diskutil)(?:\s|$)/iu;

export function bashNeedsApproval(command: string, approvalMode: ApprovalMode): boolean {
  if (approvalMode === "full") return false;
  if (SENSITIVE_COMMAND.test(command)) return true;
  return approvalMode === "request" && NETWORK_COMMAND.test(command);
}

export function createToolApprovalPolicy(
  options: { approvalMode?: ApprovalMode; getApprovalMode?: () => ApprovalMode } = {},
): GenericToolApprovalFunction<ToolSet, InferToolSetContext<ToolSet>, Record<string, unknown>> {
  return ({ toolCall }) => {
    const approvalMode = options.getApprovalMode?.() ?? options.approvalMode;
    const policy = toolPolicyFromMetadata(toolCall.toolMetadata);

    if (!policy) {
      return approvalMode === "full" ? "not-applicable" : "user-approval";
    }
    if (policy.execution === "client" || policy.capability === "interaction") return "not-applicable";
    if (toolCall.toolName === "bash" && approvalMode) {
      const command = (toolCall.input as { command?: unknown } | undefined)?.command;
      return typeof command === "string" && bashNeedsApproval(command, approvalMode)
        ? "user-approval"
        : "not-applicable";
    }
    if (approvalMode === "full") return "not-applicable";
    if (approvalMode === "request" && policy.trust === "open-world") return "user-approval";
    if (policy.source === "mcp" || policy.effect === "destructive" || policy.effect === "unknown") {
      return "user-approval";
    }
    return "not-applicable";
  };
}
