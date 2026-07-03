// AI SDK LanguageModelV4 adapter over an admin-configured OpenAI-compatible
// provider. Shared by chat (main tool-loop) and executor (html-artifact
// blocks) — both call the exact same admin-owned provider snapshot shape,
// so this was reviewed out of per-service duplication (see ADR-0015).
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type {
  ImageModelV4,
  JSONObject,
  JSONValue,
  LanguageModelV4,
  LanguageModelV4CallOptions,
} from "@ai-sdk/provider";
import { secureProviderFetch } from "./provider-url.js";

export type ReasoningEffort = "low" | "medium" | "high";

// OpenAI-compatible providers that lack native json_schema structured output
// fall back to `response_format: { type: "json_object" }`, which HARD-REJECTS
// (HTTP 400) any request whose messages never contain the literal word "json"
// (observed on Volcengine Ark's deepseek / doubao chat models). Every caller
// that pairs `generateText` + `Output.object(...)` against an admin provider
// MUST include this line in its `instructions` (or prompt), otherwise the call
// 400s on the first token and the caller silently drops to its fallback. Keep
// it here — next to the adapter that owns that json_object behavior — so it is
// a single source of truth, not re-invented per callsite.
export const JSON_OBJECT_MODE_INSTRUCTION =
  "Return your entire response as a single JSON object that matches the required schema.";

export interface ChatProvider {
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
  "messages",
  "tools",
  "tool_choice",
  "stream",
  "stream_options",
  "response_format",
  "max_tokens",
  "temperature",
  "top_p",
  "frequency_penalty",
  "presence_penalty",
  "stop",
  "seed",
  "user",
  "verbosity",
]);

function normalizeOpenAICompatibleBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  try {
    const url = new URL(trimmed);
    const pathname = url.pathname.replace(/\/+$/, "");
    if (pathname.endsWith("/chat/completions")) {
      url.pathname = pathname.slice(0, -"/chat/completions".length) || "/";
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
  if (value == null) return true;
  const type = typeof value;
  if (type === "string" || type === "boolean") return true;
  if (type === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (type !== "object") return false;
  return Object.values(value as Record<string, unknown>).every(isJsonValue);
}

function providerBodyOptions(
  provider: ChatProvider,
  options: {
    reasoningEffort?: ReasoningEffort | null;
    disableReasoning?: boolean;
    parallelToolCalls?: boolean | null;
  },
): JSONObject {
  const body: JSONObject = {};
  for (const [key, value] of Object.entries(provider.extraBody)) {
    if (!PROVIDER_BODY_RESERVED_KEYS.has(key) && isJsonValue(value)) {
      body[key] = value;
    }
  }

  if (typeof body.reasoning_effort === "string" && body.reasoningEffort == null) {
    body.reasoningEffort = body.reasoning_effort;
  }
  delete body.reasoning_effort;

  if (options.disableReasoning) {
    delete body.reasoningEffort;
    delete body.reasoning;
    body.thinking = { type: "disabled" };
    body.enable_thinking = false;
  } else if (options.reasoningEffort && body.reasoningEffort == null) {
    body.reasoningEffort = options.reasoningEffort;
  }

  // parallel_tool_calls is not in the adapter option schema nor our reserved
  // keys, so an admin value in extraBody passes through verbatim and wins.
  // Only fall back to our code default when the path opts in (the tool-using
  // chat model) and the admin left it unset; tool-less paths never send it.
  if (options.parallelToolCalls != null && body.parallel_tool_calls == null) {
    body.parallel_tool_calls = options.parallelToolCalls;
  }

  return body;
}

interface AdminOpenAICompatibleModelSnapshot {
  provider: ChatProvider;
  reasoningEffort?: ReasoningEffort | null;
  disableReasoning?: boolean;
  parallelToolCalls?: boolean | null;
}

class AdminOpenAICompatibleModel implements LanguageModelV4 {
  readonly specificationVersion = "v4" as const;
  readonly provider: string;
  readonly modelId: string;
  readonly supportedUrls = {};

  constructor(private readonly snapshot: AdminOpenAICompatibleModelSnapshot) {
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
    const openai = createOpenAICompatible({
      name: this.provider,
      baseURL: normalizeOpenAICompatibleBaseUrl(provider.baseUrl),
      apiKey: provider.apiKey,
      includeUsage: true,
      fetch: secureProviderFetch,
    });
    return openai(provider.model);
  }

  private withProviderOptions(options: LanguageModelV4CallOptions): LanguageModelV4CallOptions {
    const providerOptions = options.providerOptions ?? {};
    const existing = providerOptions[this.provider] ?? {};
    return {
      ...options,
      providerOptions: {
        ...providerOptions,
        [this.provider]: {
          ...providerBodyOptions(this.snapshot.provider, this.snapshot),
          ...existing,
        },
      },
    };
  }
}

export function createProviderModel(
  provider: ChatProvider,
  options: {
    reasoningEffort?: ReasoningEffort | null;
    disableReasoning?: boolean;
    parallelToolCalls?: boolean | null;
  } = {},
): LanguageModelV4 {
  return new AdminOpenAICompatibleModel({
    provider,
    reasoningEffort: options.reasoningEffort ?? null,
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

// Image generation over an admin-configured OpenAI-compatible provider
// (e.g. Volcengine Ark Seedream). The OpenAI-compatible image model always
// requests `response_format: "b64_json"` and parses it, so `generateImage`
// yields raw bytes regardless of the provider's configured default — those
// bytes get copied into Knowledge, never a temporary provider URL (ADR-0014).
//
// `providerOptionsKey` is the key callers pass Ark-specific request-body fields
// under (size, watermark, ...) via `generateImage({ providerOptions })`. It is
// dot-free on purpose: the image model derives its options key as
// `provider.split(".")[0]`.
export function createProviderImageModel(provider: ImageProvider): {
  model: ImageModelV4;
  providerOptionsKey: string;
} {
  const name = providerName(provider.id);
  const openai = createOpenAICompatible({
    name,
    baseURL: normalizeOpenAICompatibleBaseUrl(provider.baseUrl),
    apiKey: provider.apiKey,
    fetch: secureProviderFetch,
  });
  return { model: openai.imageModel(provider.model), providerOptionsKey: name };
}
