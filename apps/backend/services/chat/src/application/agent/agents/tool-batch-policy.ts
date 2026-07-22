import type {
  LanguageModelV4Content,
  LanguageModelV4Middleware,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";

const PLAN_WRITE_TOOLS = new Set(["write_plan", "update_plan"]);

type ExclusivePlanToolKind = "ask-user" | "plan-write";
type SkillBarrierSide = "load-skill" | "ordinary";

function exclusivePlanToolKind(toolName: string): ExclusivePlanToolKind | null {
  if (toolName === "ask_user") return "ask-user";
  return PLAN_WRITE_TOOLS.has(toolName) ? "plan-write" : null;
}

function createBatchFilter() {
  let skillBarrierSide: SkillBarrierSide | null = null;
  let exclusivePlanKind: ExclusivePlanToolKind | null = null;
  let keptLoadSkill = false;

  return (toolName: string): boolean => {
    const side: SkillBarrierSide = toolName === "load_skill" ? "load-skill" : "ordinary";
    skillBarrierSide ??= side;
    if (side !== skillBarrierSide) return false;
    if (side === "load-skill") {
      if (keptLoadSkill) return false;
      keptLoadSkill = true;
      return true;
    }
    const kind = exclusivePlanToolKind(toolName);
    if (!kind) return true;
    exclusivePlanKind ??= kind;
    return exclusivePlanKind === kind;
  };
}

function filterToolBatch(content: LanguageModelV4Content[]): LanguageModelV4Content[] {
  const keep = createBatchFilter();
  return content.filter((part) => part.type !== "tool-call" || keep(part.toolName));
}

export const toolBatchPolicyMiddleware: LanguageModelV4Middleware = {
  specificationVersion: "v4",
  wrapGenerate: async ({ doGenerate }) => {
    const result = await doGenerate();
    return { ...result, content: filterToolBatch(result.content) };
  },
  wrapStream: async ({ doStream }) => {
    const { stream, ...rest } = await doStream();
    const retainedIds = new Set<string>();
    const decidedIds = new Set<string>();
    const keep = createBatchFilter();

    return {
      ...rest,
      stream: stream.pipeThrough(
        new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
          transform(part, controller) {
            if (part.type === "tool-input-start") {
              decidedIds.add(part.id);
              if (!keep(part.toolName)) return;
              retainedIds.add(part.id);
            } else if (part.type === "tool-input-delta" || part.type === "tool-input-end") {
              if (!retainedIds.has(part.id)) return;
            } else if (part.type === "tool-call") {
              if (!decidedIds.has(part.toolCallId)) {
                decidedIds.add(part.toolCallId);
                if (!keep(part.toolName)) return;
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
