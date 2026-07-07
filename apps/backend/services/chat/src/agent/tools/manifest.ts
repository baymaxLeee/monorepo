import type { JSONObject } from "@ai-sdk/provider";
import type { ToolSet } from "ai";

import type {
  AgentToolManifest,
  AgentToolPlanning,
  AgentToolPolicy,
  ToolAvailability,
} from "./types.js";

export function defineAgentTool(
  name: string,
  definition: ToolSet[string],
  policy: Omit<AgentToolPolicy, "source"> & { source?: AgentToolPolicy["source"] },
  planning: AgentToolPlanning,
  availability: ToolAvailability = "available",
): AgentToolManifest {
  const resolvedPolicy = { source: "builtin" as const, ...policy };
  const agentMetadata = {
    capability: resolvedPolicy.capability,
    effect: resolvedPolicy.effect,
    execution: resolvedPolicy.execution,
    modes: resolvedPolicy.modes,
    source: resolvedPolicy.source,
    trust: resolvedPolicy.trust,
    ...(resolvedPolicy.uiKind ? { uiKind: resolvedPolicy.uiKind } : {}),
  } satisfies JSONObject;

  return {
    name,
    tool: {
      ...definition,
      metadata: {
        ...(definition.metadata ?? {}),
        agent: agentMetadata,
      },
    },
    policy: resolvedPolicy,
    planning,
    availability,
  };
}

export function defineUnavailableCapability(
  name: string,
  policy: Omit<AgentToolPolicy, "source"> & { source?: AgentToolPolicy["source"] },
  planning: AgentToolPlanning,
): AgentToolManifest {
  return {
    name,
    policy: { source: "builtin", ...policy },
    planning,
    availability: "requires-configuration",
  };
}

export function manifestsToTools(manifests: AgentToolManifest[]): ToolSet {
  return Object.fromEntries(
    manifests.flatMap((manifest) => (manifest.tool ? [[manifest.name, manifest.tool]] : [])),
  );
}

export function renderExecutionCapabilities(manifests: AgentToolManifest[]): string {
  const executionCapabilities = manifests.filter(
    (manifest) =>
      manifest.policy.modes.includes("normal") &&
      !manifest.policy.modes.includes("plan") &&
      manifest.policy.capability !== "planning",
  );
  if (executionCapabilities.length === 0) return "";

  const lines = executionCapabilities.map((manifest) => {
    const details = [
      manifest.planning.summary,
      manifest.planning.parallelizable ? "May run alongside independent deliverables." : null,
      ...(manifest.planning.constraints ?? []),
      ...(manifest.planning.prerequisites ?? []).map((value) => `Prerequisite: ${value}`),
    ].filter((value): value is string => Boolean(value));
    return `- ${manifest.name} [${manifest.availability}]: ${details.join(" ")}`;
  });

  return [
    "<execution_capabilities>",
    "These tools are available only after the plan is approved. Include them in the plan when appropriate; do not call them in plan mode.",
    ...lines,
    "</execution_capabilities>",
  ].join("\n");
}

export function toolPolicyFromMetadata(metadata: unknown): AgentToolPolicy | null {
  if (!metadata || typeof metadata !== "object") return null;
  const agent = (metadata as { agent?: unknown }).agent;
  if (!agent || typeof agent !== "object") return null;
  const value = agent as Partial<AgentToolPolicy>;
  if (
    typeof value.source !== "string" ||
    typeof value.effect !== "string" ||
    typeof value.capability !== "string" ||
    typeof value.trust !== "string" ||
    typeof value.execution !== "string" ||
    !Array.isArray(value.modes)
  ) {
    return null;
  }
  return value as AgentToolPolicy;
}
