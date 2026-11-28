import { MCPAppRenderer, type MCPAppBridgeHandlers, type MCPAppRendererProps } from "@ai-sdk/react";
import type { PromptInputRef } from "@repo/ai-elements/prompt-input";
import { Button } from "@repo/design-system";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { z } from "zod";

import { MCPAppContext } from "../lib/mcp-app-context";

const viewResult = z.object({
  ok: z.literal(true),
  status: z.literal("completed"),
  data: z.looseObject({
    content: z.array(z.unknown()),
    _meta: z.looseObject({
      mcpAppResource: z.object({
        callback: z.object({ pluginId: z.string().min(1), tool: z.string().min(1) }).optional(),
        uri: z.string().startsWith("ui://"),
        mimeType: z.literal("text/html;profile=mcp-app"),
        html: z.string(),
      }),
    }),
  }),
});

const sandbox = {
  url: new URL("./mcp-app-proxy.html", import.meta.url).href,
  // The proxy and the app run in separate opaque origins, also on Desktop.
  outerSandbox: "allow-scripts",
  innerSandbox: "allow-scripts",
  targetOrigin: "*",
  className: "h-64 w-full rounded-md border",
};

export const MCPAppComposer = createContext<RefObject<PromptInputRef | null> | undefined>(undefined);

const messageSchema = z.object({
  role: z.literal("user"),
  content: z.array(z.object({ type: z.literal("text"), text: z.string() })).min(1),
});
const contextSchema = z.object({
  content: z.array(z.object({ type: z.literal("text"), text: z.string() })).optional(),
  structuredContent: z.record(z.string(), z.unknown()).optional(),
});
type Suggestion = { kind: "message" | "context" | "tool"; text: string; finish: (isError: boolean) => void };

export function readMCPAppView(part: MCPAppRendererProps["part"]) {
  const policy = part.toolMetadata?.agent;
  if (
    part.state !== "output-available" ||
    part.preliminary ||
    !policy ||
    typeof policy !== "object" ||
    !("source" in policy) ||
    policy.source !== "mcp"
  )
    return null;
  const result = viewResult.safeParse(part.output);
  if (!result.success) return null;
  const { _meta, ...resultFields } = result.data.data;
  const { mcpAppResource, ...appMeta } = _meta;
  const { callback, ...resource } = mcpAppResource;
  const app = { resourceUri: resource.uri, mimeType: resource.mimeType };
  return {
    resource,
    callback,
    resultFields,
    part: { ...part, toolMetadata: { ...part.toolMetadata, app }, output: { ...resultFields, _meta: appMeta } },
  };
}

export function MCPAppView({ view }: { view: NonNullable<ReturnType<typeof readMCPAppView>> }) {
  const composer = useContext(MCPAppComposer);
  const appContext = useContext(MCPAppContext);
  const [height, setHeight] = useState<number>();
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const pending = useRef<Suggestion | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      pending.current?.finish(true);
      inFlight.current?.abort();
    },
    [view.part.toolCallId, appContext],
  );
  const { resource } = view;
  const handlers = useMemo<MCPAppBridgeHandlers>(() => {
    function review(kind: Suggestion["kind"], text: string) {
      if (pending.current) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        const request: Suggestion = {
          kind,
          text,
          finish(isError) {
            pending.current = null;
            setSuggestion(null);
            resolve(isError);
          },
        };
        pending.current = request;
        setSuggestion(request);
      });
    }
    return {
      ...(view.callback && appContext?.callTool
        ? {
            allowedTools: [view.callback.tool],
            async callTool({
              name,
              arguments: args = {},
            }: Parameters<NonNullable<MCPAppBridgeHandlers["callTool"]>>[0]) {
              if (name !== view.callback?.tool || !appContext.callTool || inFlight.current)
                throw new Error("工具不可用或正在执行");
              const controller = new AbortController();
              inFlight.current = controller;
              try {
                if (await review("tool", name + "\n" + JSON.stringify(args, null, 2)))
                  throw new Error("用户未确认调用");
                controller.signal.throwIfAborted();
                return await appContext.callTool(
                  view.part.toolCallId,
                  view.callback.pluginId,
                  name,
                  args,
                  controller.signal,
                );
              } finally {
                if (inFlight.current === controller) inFlight.current = null;
              }
            },
          }
        : {}),
      listResources: () => ({ resources: [{ uri: resource.uri, mimeType: resource.mimeType, name: resource.uri }] }),
      readResource: ({ uri }) => {
        if (uri !== resource.uri) throw new Error("资源不属于此工具调用");
        return { contents: [{ uri, mimeType: resource.mimeType, text: resource.html }] };
      },
      async sendMessage(params) {
        const parsed = messageSchema.safeParse(params);
        const text =
          parsed.success &&
          parsed.data.content
            .map((block) => block.text)
            .join("\n")
            .trim();
        return { isError: !text || !composer?.current || (await review("message", text)) };
      },
      async updateModelContext(params) {
        if (!appContext) throw new Error("此会话没有可用的模型上下文");
        const value = contextSchema.parse(params);
        const text = [
          ...(value.content ?? []).map((block) => block.text),
          ...(value.structuredContent ? [JSON.stringify(value.structuredContent)] : []),
        ].join("\n");
        if (!text && pending.current?.kind === "context") pending.current.finish(true);
        if (text && (await review("context", text))) throw new Error("用户未确认共享");
        appContext.update(view.part.toolCallId, text);
        return {};
      },
      onSizeChange({ height }) {
        if (height && Number.isFinite(height) && height > 0) setHeight(height);
      },
    };
  }, [composer, appContext, resource, view.part.toolCallId, view.callback]);
  function acceptSuggestion(request: Suggestion) {
    if (request.kind !== "message") return request.finish(false);
    const input = composer?.current;
    if (!input) return request.finish(true);
    const draft = input.getValue();
    const addition = (draft.segments.length ? "\n" : "") + request.text;
    input.setValue({
      ...draft,
      text: draft.text + addition,
      segments: [...draft.segments, { type: "text", text: addition }],
    });
    input.focus();
    request.finish(false);
  }
  return (
    <>
      <MCPAppRenderer
        part={view.part}
        resource={resource}
        handlers={handlers}
        sandbox={height ? { ...sandbox, style: { height, maxHeight: "75vh" } } : sandbox}
      />
      {suggestion && (
        <div data-agent-hidden className="space-y-2 rounded-md border p-3 text-sm">
          <p>
            {suggestion.kind === "message"
              ? "此应用建议在对话中追问"
              : suggestion.kind === "tool"
                ? "允许此应用调用只读工具？"
                : "将以下工具数据附入本会话的下一条消息？"}
          </p>
          <p className="whitespace-pre-wrap">{suggestion.text}</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => acceptSuggestion(suggestion)}>
              {suggestion.kind === "message" ? "加入输入框" : suggestion.kind === "tool" ? "允许调用" : "同意共享"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => suggestion.finish(true)}>
              忽略
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
