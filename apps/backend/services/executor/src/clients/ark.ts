// Volcengine Ark video generation (Seedance) client. Ark video is an
// asynchronous task API — create a task, then poll it to a terminal state —
// which is why it lives behind a durable executor workflow rather than an
// inline chat tool (ADR-0014). All outbound calls go through secureProviderFetch
// (SSRF guard + no redirects), the same guard chat/executor use for every
// admin-configured provider URL.
import { secureProviderFetch } from "@backend/transport-ts/provider-url";

const VIDEO_TASKS_PATH = "/contents/generations/tasks";

// Reserved keys the caller controls; everything else in the provider's
// extra_body (ratio, duration, resolution, watermark, generate_audio, seed, ...)
// is forwarded verbatim as top-level Ark request-body fields.
const VIDEO_OWNED_KEYS = new Set(["model", "content", "prompt", "test_prompt"]);

export type ArkVideoStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | (string & {});

export interface ArkVideoSnapshot {
  status: ArkVideoStatus;
  videoUrl?: string;
  error?: string;
}

// Normalize an Ark base URL to its `.../api/v3` root by stripping a known
// resource suffix if the admin pasted a full endpoint (mirrors the admin-side
// connectivity test's normalization).
export function arkApiRoot(baseUrl: string): string {
  let root = baseUrl.trim().replace(/\/+$/, "");
  for (const suffix of [VIDEO_TASKS_PATH, "/images/generations", "/chat/completions"]) {
    if (root.endsWith(suffix)) {
      root = root.slice(0, -suffix.length).replace(/\/+$/, "");
      break;
    }
  }
  return root;
}

function videoBodyOptions(extraBody: Record<string, unknown>): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extraBody)) {
    if (!VIDEO_OWNED_KEYS.has(key)) options[key] = value;
  }
  return options;
}

export async function createArkVideoTask(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  extraBody: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<string> {
  const url = `${arkApiRoot(input.baseUrl)}${VIDEO_TASKS_PATH}`;
  const response = await secureProviderFetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      content: [{ type: "text", text: input.prompt }],
      ...videoBodyOptions(input.extraBody),
    }),
    signal: input.signal,
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`ark create video task failed: ${response.status} ${detail}`);
  }
  const data = (await response.json()) as { id?: string };
  if (!data.id) throw new Error("ark create video task returned no task id");
  return data.id;
}

export async function getArkVideoTask(input: {
  baseUrl: string;
  apiKey: string;
  taskId: string;
  signal?: AbortSignal;
}): Promise<ArkVideoSnapshot> {
  const url = `${arkApiRoot(input.baseUrl)}${VIDEO_TASKS_PATH}/${encodeURIComponent(input.taskId)}`;
  const response = await secureProviderFetch(url, {
    headers: { Authorization: `Bearer ${input.apiKey}` },
    signal: input.signal,
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`ark query video task failed: ${response.status} ${detail}`);
  }
  const data = (await response.json()) as {
    status?: string;
    content?: { video_url?: string } | null;
    error?: unknown;
  };
  const error =
    typeof data.error === "string"
      ? data.error
      : data.error
        ? JSON.stringify(data.error).slice(0, 500)
        : undefined;
  return {
    status: (data.status as ArkVideoStatus) ?? "unknown",
    videoUrl: data.content?.video_url,
    error,
  };
}

// Download the finished video bytes. Ark returns a temporary signed URL; we copy
// the bytes into Knowledge immediately and never persist the URL (ADR-0014).
export async function downloadArkVideo(input: {
  videoUrl: string;
  signal?: AbortSignal;
}): Promise<{ bytes: Uint8Array; mediaType: string }> {
  const response = await secureProviderFetch(input.videoUrl, { signal: input.signal });
  if (!response.ok) {
    throw new Error(`ark video download failed: ${response.status}`);
  }
  const rawMime = response.headers.get("content-type") ?? "video/mp4";
  const mediaType = rawMime.split(";")[0]?.trim() || "video/mp4";
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error("ark video download returned no bytes");
  return { bytes, mediaType };
}
