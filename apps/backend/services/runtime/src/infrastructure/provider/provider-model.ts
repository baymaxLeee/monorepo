import { createOpenAI, type OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import type {
  ImageModelV4,
  JSONObject,
  JSONValue,
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Middleware,
} from "@ai-sdk/provider";
import { wrapLanguageModel } from "ai";

import { secureProviderFetch } from "./provider-url.js";

export const JSON_OBJECT_MODE_INSTRUCTION =
  "Return your entire response as a single JSON object that matches the required schema.";

export interface LanguageProviderSnapshot {
  id: string;
  name: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  extraBody: Record<string, unknown>;
  contextWindow: number;
  maxOutputTokens: number;
}

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

const PROVIDER_BODY_RESERVED_KEYS = new Set([
  "model",
  "input",
  "instructions",
  "tools",
  "tool_choice",
  "stream",
  "store",
  "previous_response_id",
  "conversation",
  "context_management",
  "max_output_tokens",
  "temperature",
  "top_p",
  "user",
  "reasoning_effort",
  "parallel_tool_calls",
]);

const PROVIDER_REQUEST_TIMEOUT_MS = 120_000;

async function secureProviderRequest(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
  const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const timeout = new AbortController();
  const timer = setTimeout(
    () => timeout.abort(new DOMException("Provider request timeout", "TimeoutError")),
    PROVIDER_REQUEST_TIMEOUT_MS,
  );
  try {
    return await secureProviderFetch(input, {
      ...init,
      signal: callerSignal ? AbortSignal.any([callerSignal, timeout.signal]) : timeout.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeOpenAIBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  try {
    const url = new URL(trimmed);
    const pathname = url.pathname.replace(/\/+$/, "");
    for (const suffix of ["/responses"] as const) {
      if (!pathname.endsWith(suffix)) {
        continue;
      }
      url.pathname = pathname.slice(0, -suffix.length) || "/";
      return url.toString().replace(/\/+$/, "");
    }
    if (!pathname || pathname === "/") {
      url.pathname = "/v1";
      return url.toString().replace(/\/+$/, "");
    }
  } catch {
    return trimmed;
  }
  return trimmed;
}

function providerName(providerId: string): string {
  return `adminProvider-${providerId}`;
}

function isJsonValue(value: unknown): value is JSONValue {
  if (value == null) {
    return true;
  }
  const type = typeof value;
  if (type === "string" || type === "boolean") {
    return true;
  }
  if (type === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (type !== "object") {
    return false;
  }
  return Object.values(value as Record<string, unknown>).every(isJsonValue);
}

function providerBodyOptions(
  provider: LanguageProviderSnapshot,
  options: { parallelToolCalls?: boolean | null; reasoningEffort?: ReasoningEffort | null },
): { requestBody: JSONObject; providerOptions: OpenAIResponsesProviderOptions } {
  const body: JSONObject = {};
  for (const [key, value] of Object.entries(provider.extraBody)) {
    if (!PROVIDER_BODY_RESERVED_KEYS.has(key) && isJsonValue(value)) {
      body[key] = value;
    }
  }

  const providerOptions: OpenAIResponsesProviderOptions = {
    parallelToolCalls: options.parallelToolCalls ?? undefined,
    reasoningEffort: options.reasoningEffort ?? undefined,
    store: true,
  };

  return { requestBody: body, providerOptions };
}

function normalizeResponsesEventLine(line: string): string | null {
  if (!line.startsWith("data:")) {
    return line;
  }
  const payload = line.slice(5).trimStart();
  if (!payload.startsWith("{")) {
    return line;
  }
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return line;
  }
  if (
    event.type === "response.output_item.added" &&
    event.item &&
    typeof event.item === "object" &&
    (event.item as { type?: unknown }).type === "function_call" &&
    typeof (event.item as { arguments?: unknown }).arguments !== "string"
  ) {
    (event.item as { arguments: string }).arguments = "";
    return `data: ${JSON.stringify(event)}`;
  }
  if (
    (event.type === "response.content_part.added" || event.type === "response.content_part.done") &&
    event.part &&
    typeof event.part === "object" &&
    (event.part as { type?: unknown }).type === "reasoning_text"
  ) {
    return null;
  }
  if (event.type === "response.reasoning_text.delta") {
    event.type = "response.reasoning_summary_text.delta";
    event.summary_index = typeof event.content_index === "number" ? event.content_index : 0;
    delete event.content_index;
    return `data: ${JSON.stringify(event)}`;
  }
  if (event.type === "response.reasoning_text.done") {
    event.type = "response.reasoning_summary_part.done";
    event.summary_index = typeof event.content_index === "number" ? event.content_index : 0;
    event.part = { type: "summary_text", text: typeof event.text === "string" ? event.text : "" };
    delete event.content_index;
    delete event.text;
    return `data: ${JSON.stringify(event)}`;
  }
  return line;
}

function normalizeResponsesStream(response: Response): Response {
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
    return response;
  }
  let buffered = "";
  const stream = response.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(
      new TransformStream<string, string>({
        transform(chunk, controller) {
          buffered += chunk;
          const lines = buffered.split("\n");
          buffered = lines.pop() ?? "";
          for (const rawLine of lines) {
            const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
            const normalized = normalizeResponsesEventLine(line);
            if (normalized != null) {
              controller.enqueue(`${normalized}\n`);
            }
          }
        },
        flush(controller) {
          if (buffered) {
            const normalized = normalizeResponsesEventLine(buffered);
            if (normalized != null) {
              controller.enqueue(normalized);
            }
          }
        },
      }),
    )
    .pipeThrough(new TextEncoderStream());
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function normalizeResponsesJson(response: Response): Promise<Response> {
  if (!response.headers.get("content-type")?.includes("application/json")) {
    return response;
  }
  const body = (await response.json()) as unknown;
  if (!body || typeof body !== "object") {
    return new Response(JSON.stringify(body), response);
  }
  const output = (body as { output?: unknown }).output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (
        item &&
        typeof item === "object" &&
        (item as { type?: unknown }).type === "function_call" &&
        typeof (item as { arguments?: unknown }).arguments !== "string"
      ) {
        (item as { arguments: string }).arguments = "";
      }
      if (!item || typeof item !== "object" || (item as { type?: unknown }).type !== "message") {
        continue;
      }
      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) {
        continue;
      }
      for (const part of content) {
        if (part && typeof part === "object" && (part as { type?: unknown }).type === "output_text") {
          const text = part as { annotations?: unknown };
          if (!Array.isArray(text.annotations)) {
            text.annotations = [];
          }
        }
      }
    }
  }
  return new Response(JSON.stringify(body), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function createResponsesFetch(extraBody: JSONObject): typeof fetch {
  return async (input, init) => {
    if (typeof init?.body !== "string") {
      return secureProviderRequest(input, init);
    }
    const url = input instanceof Request ? input.url : input.toString();
    if (!url.endsWith("/responses")) {
      return secureProviderRequest(input, init);
    }
    const body = JSON.parse(init.body) as JSONObject;
    Object.assign(body, extraBody);
    delete body.context_management;
    const response = await secureProviderRequest(input, { ...init, body: JSON.stringify(body) });
    return response.headers.get("content-type")?.includes("text/event-stream")
      ? normalizeResponsesStream(response)
      : normalizeResponsesJson(response);
  };
}

function prepareArkPrompt(
  prompt: LanguageModelV4CallOptions["prompt"],
  explicitInstructions: string | null | undefined,
): { prompt: LanguageModelV4CallOptions["prompt"]; instructions: string | undefined } {
  const systemInstructions: string[] = [];
  const input = prompt.filter((message) => {
    if (message.role !== "system") {
      return true;
    }
    systemInstructions.push(message.content);
    return false;
  });
  const instructions = [explicitInstructions, ...systemInstructions].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return { prompt: input, instructions: instructions.length > 0 ? instructions.join("\n\n") : undefined };
}

function materializeArkPrompt(prompt: LanguageModelV4CallOptions["prompt"]): LanguageModelV4CallOptions["prompt"] {
  return prompt.map((message) => {
    if (message.role !== "assistant") return message;
    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type === "custom") return part;
        const openaiOptions = part.providerOptions?.openai;
        if (!openaiOptions || !("itemId" in openaiOptions)) return part;
        const { itemId: _itemId, ...materializedOptions } = openaiOptions;
        return {
          ...part,
          providerOptions: {
            ...part.providerOptions,
            openai: materializedOptions,
          },
        };
      }),
    };
  });
}

export function createProviderModel(
  provider: LanguageProviderSnapshot,
  options: { parallelToolCalls?: boolean | null; reasoningEffort?: ReasoningEffort | null } = {},
): LanguageModelV4 {
  const name = providerName(provider.id);
  const { requestBody, providerOptions: configured } = providerBodyOptions(provider, options);
  const openai = createOpenAI({
    name,
    baseURL: normalizeOpenAIBaseUrl(provider.baseUrl),
    apiKey: provider.apiKey,
    fetch: createResponsesFetch(requestBody),
  });
  const providerSettings: LanguageModelV4Middleware = {
    specificationVersion: "v4",
    transformParams: async ({ params }) => {
      const openaiOptions = {
        ...configured,
        ...params.providerOptions?.openai,
        store: params.providerOptions?.openai?.store === false ? false : true,
      };
      openaiOptions.contextManagement = undefined;
      // Ark item references are valid only inside the stored response lineage
      // that created them. Once previous_response_id is unavailable, send the
      // materialized local journal instead of dangling provider references.
      const prompt =
        openaiOptions.previousResponseId || openaiOptions.store === false
          ? params.prompt
          : materializeArkPrompt(params.prompt);
      const arkPrompt = prepareArkPrompt(prompt, openaiOptions.instructions);
      openaiOptions.instructions = arkPrompt.instructions;
      return {
        ...params,
        prompt: arkPrompt.prompt,
        providerOptions: {
          ...params.providerOptions,
          openai: openaiOptions,
        },
      };
    },
  };
  return wrapLanguageModel({
    model: openai.responses(provider.model),
    middleware: providerSettings,
    providerId: name,
  });
}

export interface ImageProvider {
  id: string;
  model: string;
  baseUrl: string;
  apiKey: string;
}

export function createProviderImageModel(provider: ImageProvider): {
  model: ImageModelV4;
  providerOptionsKey: string;
} {
  const name = providerName(provider.id);
  const openai = createOpenAI({
    name,
    baseURL: normalizeOpenAIBaseUrl(provider.baseUrl),
    apiKey: provider.apiKey,
    fetch: secureProviderFetch,
  });
  return { model: openai.imageModel(provider.model), providerOptionsKey: "openai" };
}
