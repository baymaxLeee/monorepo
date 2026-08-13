import { createOpenAI, type OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import type {
  ImageModelV4,
  JSONObject,
  JSONValue,
  LanguageModelV4,
  LanguageModelV4CallOptions,
} from "@ai-sdk/provider";

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
    disableReasoning?: boolean;
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
    store: true,
  };

  if (options.disableReasoning) {
    delete body.reasoning;
    body.thinking = { type: "disabled" };
    body.enable_thinking = false;
  }

  return { requestBody: body, providerOptions };
}

function normalizeReasoningEventLine(line: string): string | null {
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
            const normalized = normalizeReasoningEventLine(line);
            if (normalized != null) {
              controller.enqueue(`${normalized}\n`);
            }
          }
        },
        flush(controller) {
          if (buffered) {
            const normalized = normalizeReasoningEventLine(buffered);
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
      return secureProviderFetch(input, init);
    }
    const url = input instanceof Request ? input.url : input.toString();
    if (!url.endsWith("/responses")) {
      return secureProviderFetch(input, init);
    }
    const body = JSON.parse(init.body) as JSONObject;
    Object.assign(body, extraBody);
    const response = await secureProviderFetch(input, { ...init, body: JSON.stringify(body) });
    return response.headers.get("content-type")?.includes("text/event-stream")
      ? normalizeResponsesStream(response)
      : normalizeResponsesJson(response);
  };
}

interface AdminResponsesModelSnapshot {
  provider: LanguageProviderSnapshot;
  disableReasoning?: boolean;
  parallelToolCalls?: boolean | null;
}

class AdminResponsesModel implements LanguageModelV4 {
  readonly specificationVersion = "v4" as const;
  readonly provider: string;
  readonly modelId: string;
  readonly supportedUrls = {};

  constructor(private readonly snapshot: AdminResponsesModelSnapshot) {
    this.provider = providerName(snapshot.provider.id);
    this.modelId = snapshot.provider.model;
  }

  doGenerate(options: LanguageModelV4CallOptions): ReturnType<LanguageModelV4["doGenerate"]> {
    return this.delegate().doGenerate(this.withProviderOptions(options));
  }

  doStream(options: LanguageModelV4CallOptions): ReturnType<LanguageModelV4["doStream"]> {
    return this.delegate().doStream(this.withProviderOptions(options));
  }

  private delegate(): LanguageModelV4 {
    const provider = this.snapshot.provider;
    const { requestBody } = providerBodyOptions(provider, this.snapshot);
    const openai = createOpenAI({
      name: this.provider,
      baseURL: normalizeOpenAIBaseUrl(provider.baseUrl),
      apiKey: provider.apiKey,
      fetch: createResponsesFetch(requestBody),
    });
    return openai.responses(provider.model);
  }

  private withProviderOptions(options: LanguageModelV4CallOptions): LanguageModelV4CallOptions {
    const providerOptions = options.providerOptions ?? {};
    const existing = providerOptions.openai ?? {};
    const { providerOptions: configured } = providerBodyOptions(this.snapshot.provider, this.snapshot);
    return {
      ...options,
      providerOptions: {
        ...providerOptions,
        openai: {
          ...configured,
          ...existing,
        },
      },
    };
  }
}

export function createProviderModel(
  provider: LanguageProviderSnapshot,
  options: {
    disableReasoning?: boolean;
    parallelToolCalls?: boolean | null;
  } = {},
): LanguageModelV4 {
  return new AdminResponsesModel({
    provider,
    disableReasoning: options.disableReasoning ?? false,
    parallelToolCalls: options.parallelToolCalls ?? null,
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
