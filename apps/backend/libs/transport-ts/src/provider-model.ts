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

export type ResponsesDialect = "openai_responses" | "ark_responses" | "deepseek_responses";

export interface LanguageProviderSnapshot {
  id: string;
  name: string;
  model: string;
  responsesDialect: ResponsesDialect;
  baseUrl: string;
  apiKey: string;
  extraBody: Record<string, unknown>;
  contextWindow: number;
  maxOutputTokens: number;
}

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
  options: {
    parallelToolCalls?: boolean | null;
  },
): { requestBody: JSONObject; providerOptions: OpenAIResponsesProviderOptions } {
  const body: JSONObject = {};
  for (const [key, value] of Object.entries(provider.extraBody)) {
    if (!PROVIDER_BODY_RESERVED_KEYS.has(key) && isJsonValue(value)) {
      body[key] = value;
    }
  }

  const providerOptions: OpenAIResponsesProviderOptions = {
    parallelToolCalls: options.parallelToolCalls ?? undefined,
    store: provider.responsesDialect === "deepseek_responses" ? false : true,
  };

  return { requestBody: body, providerOptions };
}

function normalizeResponsesEventLine(line: string, dialect: ResponsesDialect): string | null {
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
    dialect === "ark_responses" &&
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

function normalizeResponsesStream(response: Response, dialect: ResponsesDialect): Response {
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
            const normalized = normalizeResponsesEventLine(line, dialect);
            if (normalized != null) {
              controller.enqueue(`${normalized}\n`);
            }
          }
        },
        flush(controller) {
          if (buffered) {
            const normalized = normalizeResponsesEventLine(buffered, dialect);
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

async function normalizeResponsesJson(response: Response, dialect: ResponsesDialect): Promise<Response> {
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
        dialect === "ark_responses" &&
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

function normalizeDeepSeekRequest(body: JSONObject): void {
  delete body.previous_response_id;
  delete body.conversation;
  delete body.context_management;
  body.store = false;

  if (!Array.isArray(body.input)) {
    return;
  }
  body.input = body.input.map((item: JSONValue) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return item;
    }
    const record = item as JSONObject;
    if (record.type !== "reasoning") {
      return item;
    }
    const summary = Array.isArray(record.summary)
      ? record.summary
          .filter(
            (part: JSONValue): part is { type: "summary_text"; text: string } =>
              !!part &&
              typeof part === "object" &&
              !Array.isArray(part) &&
              (part as JSONObject).type === "summary_text" &&
              typeof (part as JSONObject).text === "string",
          )
          .map((part) => ({ type: "reasoning_text", text: part.text }))
      : [];
    const { summary: _summary, encrypted_content: _encryptedContent, ...rest } = record;
    return { ...rest, content: summary };
  });
}

function createResponsesFetch(dialect: ResponsesDialect, extraBody: JSONObject): typeof fetch {
  return async (input, init) => {
    if (typeof init?.body !== "string") {
      return secureProviderFetch(input, init);
    }
    const url = input instanceof Request ? input.url : input.toString();
    if (!url.endsWith("/responses")) {
      return secureProviderFetch(input, init);
    }
    const body = JSON.parse(init.body) as JSONObject;
    Object.assign(body, extraBody);
    if (dialect === "deepseek_responses") {
      normalizeDeepSeekRequest(body);
    }
    const response = await secureProviderFetch(input, { ...init, body: JSON.stringify(body) });
    return response.headers.get("content-type")?.includes("text/event-stream")
      ? normalizeResponsesStream(response, dialect)
      : normalizeResponsesJson(response, dialect);
  };
}

function prepareDeepSeekReasoningReplay(
  prompt: LanguageModelV4CallOptions["prompt"],
): LanguageModelV4CallOptions["prompt"] {
  return prompt.map((message) =>
    message.role !== "assistant"
      ? message
      : {
          ...message,
          content: message.content.map((part) =>
            part.type !== "reasoning"
              ? part
              : {
                  ...part,
                  providerOptions: {
                    ...part.providerOptions,
                    openai: {
                      ...part.providerOptions?.openai,
                      reasoningEncryptedContent: "deepseek-plaintext-replay",
                    },
                  },
                },
          ),
        },
  );
}

export function createProviderModel(
  provider: LanguageProviderSnapshot,
  options: {
    parallelToolCalls?: boolean | null;
  } = {},
): LanguageModelV4 {
  const name = providerName(provider.id);
  const { requestBody, providerOptions: configured } = providerBodyOptions(provider, options);
  const openai = createOpenAI({
    name,
    baseURL: normalizeOpenAIBaseUrl(provider.baseUrl),
    apiKey: provider.apiKey,
    fetch: createResponsesFetch(provider.responsesDialect, requestBody),
  });
  const providerSettings: LanguageModelV4Middleware = {
    specificationVersion: "v4",
    transformParams: async ({ params }) => {
      const openaiOptions = {
        ...configured,
        ...params.providerOptions?.openai,
      };
      if (provider.responsesDialect === "deepseek_responses") {
        openaiOptions.store = false;
        openaiOptions.previousResponseId = undefined;
        openaiOptions.conversation = undefined;
        openaiOptions.contextManagement = undefined;
      }
      return {
        ...params,
        prompt:
          provider.responsesDialect === "deepseek_responses"
            ? prepareDeepSeekReasoningReplay(params.prompt)
            : params.prompt,
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
