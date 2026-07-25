import type { InferToolSetContext } from "@ai-sdk/provider-utils";
import type { GenericToolApprovalFunction, ToolSet } from "ai";

import type { AgentRuntimeContext } from "../agents/types.js";
import { toolPolicyFromMetadata } from "./manifest.js";

export function createToolApprovalPolicy(
  mode: AgentRuntimeContext["profileId"],
): GenericToolApprovalFunction<ToolSet, InferToolSetContext<ToolSet>, AgentRuntimeContext> {
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
