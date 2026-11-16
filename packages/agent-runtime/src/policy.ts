import type { InferToolSetContext } from "@ai-sdk/provider-utils";
import type { GenericToolApprovalFunction, ToolSet } from "ai";

import { toolPolicyFromMetadata } from "./manifest.js";
import type { AgentMode } from "./types.js";

export function createToolApprovalPolicy(
  mode: AgentMode,
): GenericToolApprovalFunction<ToolSet, InferToolSetContext<ToolSet>, Record<string, unknown>> {
  return ({ toolCall }) => {
    const policy = toolPolicyFromMetadata(toolCall.toolMetadata);

    if (mode === "plan" && (!policy || !policy.modes.includes("plan"))) {
      return { type: "denied", reason: "This capability is unavailable in plan mode." };
    }
    if (!policy) {
      return "user-approval";
    }
    if (policy.source === "mcp" || policy.effect === "destructive" || policy.effect === "unknown") {
      return "user-approval";
    }
    return "not-applicable";
  };
}
