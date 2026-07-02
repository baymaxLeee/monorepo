// Volcengine Ark video generation (Seedance) client. Ark video is an
// asynchronous task API — create a task, then poll it to a terminal state —
// which is why it lives behind a durable executor workflow rather than an
// inline chat tool (ADR-0014). All outbound calls go through secureProviderFetch
// (SSRF guard + no redirects), the same guard chat/executor use for every
// admin-configured provider URL.
import { secureProviderFetch } from "@backend/transport-ts/provider-url";

const VIDEO_TASKS_PATH = "/contents/generations/tasks";

// Ark native video params for POST /contents/generations/tasks. The duration
// field is `seconds` (a STRING), NOT `duration` — Seedance 2.0 rejects a
// top-level `duration` in t2v ("parameter duration ... is not valid"). We
// allowlist the documented params and map common config aliases, so stray
// extra_body keys (e.g. the admin test-only `test_poll_seconds`) or the legacy
// `duration` key can no longer 400 the request.
const ARK_VIDEO_PARAMS = new Set([
  "seconds",
  "ratio",
  "resolution",
  "framespersecond",
  "camerafixed",
  "watermark",
  "return_last_frame",
  "generate_audio",
  "seed",
  "size",
  "service_tier",
  "tools",
]);

const ARK_VIDEO_ALIASES: Record<string, string> = {
  duration: "seconds",
  fps: "framespersecond",
  camera_fixed: "camerafixed",
};

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
  for (const [rawKey, rawValue] of Object.entries(extraBody)) {
    const key = ARK_VIDEO_ALIASES[rawKey] ?? rawKey;
    if (!ARK_VIDEO_PARAMS.has(key)) continue;
    // `seconds` is a string in the Ark native format ("5", not 5).
    options[key] =
      key === "seconds" && typeof rawValue === "number" ? String(rawValue) : rawValue;
  }
  return options;
}

export async function createArkVideoTask(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  // Per-request video length in seconds. Ark Seedance reads `duration` as a
  // top-level request-body integer (supported range ~4–15, default ~5 when
  // omitted). An explicit value here wins over any `duration` an admin baked
  // into the provider's extra_body, so callers can set it per conversation.
  duration?: number;
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
      ...(input.duration != null ? { duration: input.duration } : {}),
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
