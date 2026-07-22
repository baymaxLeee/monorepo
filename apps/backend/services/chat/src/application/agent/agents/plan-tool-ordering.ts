import type {
  LanguageModelV4Content,
  LanguageModelV4Middleware,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";

const PLAN_WRITE_TOOLS = new Set(["write_plan", "update_plan"]);

type ExclusivePlanToolKind = "ask-user" | "plan-write";

function exclusivePlanToolKind(toolName: string): ExclusivePlanToolKind | null {
  if (toolName === "ask_user") return "ask-user";
  return PLAN_WRITE_TOOLS.has(toolName) ? "plan-write" : null;
}

function keepFirstExclusiveToolGroup(content: LanguageModelV4Content[]): LanguageModelV4Content[] {
  let selected: ExclusivePlanToolKind | null = null;
  return content.filter((part) => {
    if (part.type !== "tool-call") return true;
    const kind = exclusivePlanToolKind(part.toolName);
    if (!kind) return true;
    selected ??= kind;
    return selected === kind;
  });
}

export const planToolOrderingMiddleware: LanguageModelV4Middleware = {
  specificationVersion: "v4",
  wrapGenerate: async ({ doGenerate }) => {
    const result = await doGenerate();
    return { ...result, content: keepFirstExclusiveToolGroup(result.content) };
  },
  wrapStream: async ({ doStream }) => {
    const { stream, ...rest } = await doStream();
    const toolNames = new Map<string, string>();
    let selected: ExclusivePlanToolKind | null = null;

    const shouldKeep = (toolName: string): boolean => {
      const kind = exclusivePlanToolKind(toolName);
      if (!kind) return true;
      selected ??= kind;
      return selected === kind;
    };

    return {
      ...rest,
      stream: stream.pipeThrough(
        new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
          transform(part, controller) {
            if (part.type === "tool-input-start") {
              toolNames.set(part.id, part.toolName);
              if (!shouldKeep(part.toolName)) return;
            } else if (part.type === "tool-input-delta" || part.type === "tool-input-end") {
              if (!shouldKeep(toolNames.get(part.id) ?? "")) return;
            } else if (part.type === "tool-call") {
              toolNames.set(part.toolCallId, part.toolName);
              if (!shouldKeep(part.toolName)) return;
            }

            controller.enqueue(part);
          },
        }),
      ),
    };
  },
};
