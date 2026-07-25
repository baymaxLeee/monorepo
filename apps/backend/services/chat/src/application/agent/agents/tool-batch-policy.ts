import type { LanguageModelV4Content, LanguageModelV4Middleware, LanguageModelV4StreamPart } from "@ai-sdk/provider";

import type { AgentMode } from "./types.js";

type ExclusivePlanToolKind = "ask-user" | "plan-write";
type SkillBarrierSide = "load-skill" | "ordinary";

function exclusivePlanToolKind(mode: AgentMode, toolName: string): ExclusivePlanToolKind | null {
  if (toolName === "ask_user") {
    return "ask-user";
  }
  return mode === "plan" && toolName === "write_file" ? "plan-write" : null;
}

function createBatchFilter(mode: AgentMode) {
  let skillBarrierSide: SkillBarrierSide | null = null;
  let exclusivePlanKind: ExclusivePlanToolKind | null = null;
  let keptLoadSkill = false;

  return (toolName: string): boolean => {
    const side: SkillBarrierSide = toolName === "load_skill" ? "load-skill" : "ordinary";
    skillBarrierSide ??= side;
    if (side !== skillBarrierSide) {
      return false;
    }
    if (side === "load-skill") {
      if (keptLoadSkill) {
        return false;
      }
      keptLoadSkill = true;
      return true;
    }
    const kind = exclusivePlanToolKind(mode, toolName);
    if (!kind) {
      return true;
    }
    exclusivePlanKind ??= kind;
    return exclusivePlanKind === kind;
  };
}

function filterToolBatch(mode: AgentMode, content: LanguageModelV4Content[]): LanguageModelV4Content[] {
  const keep = createBatchFilter(mode);
  return content.filter((part) => part.type !== "tool-call" || keep(part.toolName));
}

export function createToolBatchPolicyMiddleware(mode: AgentMode): LanguageModelV4Middleware {
  return {
    specificationVersion: "v4",
    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate();
      return { ...result, content: filterToolBatch(mode, result.content) };
    },
    wrapStream: async ({ doStream }) => {
      const { stream, ...rest } = await doStream();
      const retainedIds = new Set<string>();
      const decidedIds = new Set<string>();
      const keep = createBatchFilter(mode);

      return {
        ...rest,
        stream: stream.pipeThrough(
          new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
            transform(part, controller) {
              if (part.type === "tool-input-start") {
                decidedIds.add(part.id);
                if (!keep(part.toolName)) {
                  return;
                }
                retainedIds.add(part.id);
              } else if (part.type === "tool-input-delta" || part.type === "tool-input-end") {
                if (!retainedIds.has(part.id)) {
                  return;
                }
              } else if (part.type === "tool-call") {
                if (!decidedIds.has(part.toolCallId)) {
                  decidedIds.add(part.toolCallId);
                  if (!keep(part.toolName)) {
                    return;
                  }
                  retainedIds.add(part.toolCallId);
                } else if (!retainedIds.has(part.toolCallId)) {
                  return;
                }
              }
              controller.enqueue(part);
            },
          }),
        ),
      };
    },
  };
}
