import type {
  LanguageModelV4Content,
  LanguageModelV4Middleware,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";

const PLAN_WRITE_TOOLS = new Set(["write_plan", "update_plan"]);

function hasAskUser(content: LanguageModelV4Content[]): boolean {
  return content.some((part) => part.type === "tool-call" && part.toolName === "ask_user");
}

function withoutPlanWrites(content: LanguageModelV4Content[]): LanguageModelV4Content[] {
  return content.filter(
    (part) => part.type !== "tool-call" || !PLAN_WRITE_TOOLS.has(part.toolName),
  );
}

export const planToolOrderingMiddleware: LanguageModelV4Middleware = {
  specificationVersion: "v4",
  wrapGenerate: async ({ doGenerate }) => {
    const result = await doGenerate();
    if (!hasAskUser(result.content)) return result;
    return { ...result, content: withoutPlanWrites(result.content) };
  },
  wrapStream: async ({ doStream }) => {
    const { stream, ...rest } = await doStream();
    const toolNames = new Map<string, string>();
    let askUserSeen = false;
    let bufferedPlanParts: LanguageModelV4StreamPart[] = [];

    const flushPlanParts = (
      controller: TransformStreamDefaultController<LanguageModelV4StreamPart>,
    ) => {
      if (!askUserSeen) {
        for (const part of bufferedPlanParts) controller.enqueue(part);
      }
      bufferedPlanParts = [];
    };

    return {
      ...rest,
      stream: stream.pipeThrough(
        new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
          transform(part, controller) {
            if (part.type === "tool-input-start") {
              toolNames.set(part.id, part.toolName);
              if (part.toolName === "ask_user") askUserSeen = true;
              if (PLAN_WRITE_TOOLS.has(part.toolName)) {
                bufferedPlanParts.push(part);
                return;
              }
            } else if (part.type === "tool-input-delta" || part.type === "tool-input-end") {
              if (PLAN_WRITE_TOOLS.has(toolNames.get(part.id) ?? "")) {
                bufferedPlanParts.push(part);
                return;
              }
            } else if (part.type === "tool-call") {
              toolNames.set(part.toolCallId, part.toolName);
              if (part.toolName === "ask_user") askUserSeen = true;
              if (PLAN_WRITE_TOOLS.has(part.toolName)) {
                bufferedPlanParts.push(part);
                return;
              }
            } else if (part.type === "finish") {
              flushPlanParts(controller);
            }

            controller.enqueue(part);
          },
          flush(controller) {
            flushPlanParts(controller);
          },
        }),
      ),
    };
  },
};
