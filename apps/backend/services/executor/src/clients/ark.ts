// Volcengine Ark video generation (Seedance) client. Ark video is an
// asynchronous task API — create a task, then poll it to a terminal state —
// which is why it lives behind a durable executor workflow rather than an
// inline chat tool (ADR-0014). All outbound calls go through secureProviderFetch
// (SSRF guard + no redirects), the same guard chat/executor use for every
// admin-configured provider URL.
import { secureProviderFetch } from "@backend/transport-ts/provider-url";

const VIDEO_TASKS_PATH = "/contents/generations/tasks";

// Ark native video params for POST /contents/generations/tasks.
//
// DURATION: the per-clip length we send is `seconds` (a STRING, e.g. "6"), NOT a
// top-level integer `duration`. This matches what was observed against the
// deployed endpoint (a top-level `duration` was rejected as "parameter duration
// ... is not valid"); `videoBodyOptions` also maps a legacy `duration` alias
// onto it. Seedance 2.0's published native format instead documents an integer
// `duration` (4–15), so this is worth re-verifying now that the storyboard sets
// a DIFFERENT length per scene: if the model ever ignores `seconds` (every clip
// comes back at the default length regardless of the per-scene value), flip the
// wire format here to an integer `duration`. To check, compare the
// `requestedSeconds` logged at create time with the `actualDuration` logged when
// the task succeeds (see createArkVideoTask / getArkVideoTask below).
//
// We allowlist the documented params and map common config aliases, so a stray
// extra_body key (e.g. the admin test-only `test_poll_seconds`) or the legacy
// `duration` key can no longer 400 the request. `camera_fixed` was a Seedance
// 1.x knob the 2.0 series dropped, so `camerafixed` is intentionally no longer
// allowlisted (2.0 ignores it — keep it out to reflect real 2.0 capability).
const ARK_VIDEO_PARAMS = new Set([
  "seconds",
  "ratio",
  "resolution",
  "framespersecond",
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

// Ark native video content item. Text is always present; a single reference
// image can be attached with role `reference_image` for loose subject
// consistency across independently-generated scene clips.
//
// IMPORTANT: `image_url.url` MUST be a reachable public HTTP(S) URL — Seedance's
// native task API hangs indefinitely (no response, no error) when given a
// base64 `data:` URI here, which manifests downstream as every scene's create
// call timing out. Always pass a URL (e.g. the anchor image's Ark/TOS URL), not
// inline base64. We also deliberately DO NOT combine it with
// `first_frame`/`last_frame`: Seedance treats first/last-frame, first-frame, and
// multimodal-reference as three mutually exclusive input modes, so mixing them
// 400s the request.
type ArkContentItem =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string }; role: "reference_image" };

// Defaults tuned for vertical short-drama (抖音/小红书 投流): portrait 9:16,
// 720p, native audio on. Each is only a default — an admin `extra_body` value
// (mapped through videoBodyOptions) overrides it, and per-request `seconds`
// overrides the length last of all.
const ARK_VIDEO_DEFAULTS = {
  ratio: "9:16",
  resolution: "720p",
  generate_audio: true,
} as const;

export async function createArkVideoTask(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  // Per-request clip length in whole seconds. Sent as the top-level `seconds`
  // STRING (not a top-level `duration` int — Seedance 2.0's native task API
  // rejects that as "parameter duration ... is not valid"; see ARK_VIDEO_PARAMS
  // above). Wins over any `seconds`/`duration` alias an admin baked into
  // extra_body, so the workflow can set each scene's length.
  seconds?: number;
  // Optional single subject-anchor image, role reference_image. MUST be a
  // reachable public HTTP(S) URL (see ArkContentItem: a base64 data-URI hangs
  // the create call). Mutually exclusive with first/last-frame modes (unused here).
  referenceImage?: string;
  // Optional fixed seed shared across a run's scenes for reproducibility.
  seed?: number;
  extraBody: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<string> {
  const url = `${arkApiRoot(input.baseUrl)}${VIDEO_TASKS_PATH}`;
  const content: ArkContentItem[] = [{ type: "text", text: input.prompt }];
  if (input.referenceImage) {
    content.push({ type: "image_url", image_url: { url: input.referenceImage }, role: "reference_image" });
  }
  const response = await secureProviderFetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      content,
      ...ARK_VIDEO_DEFAULTS,
      ...videoBodyOptions(input.extraBody),
      ...(input.seed != null ? { seed: input.seed } : {}),
      ...(input.seconds != null ? { seconds: String(input.seconds) } : {}),
    }),
    signal: input.signal,
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`ark create video task failed: ${response.status} ${detail}`);
  }
  const data = (await response.json()) as { id?: string };
  if (!data.id) throw new Error("ark create video task returned no task id");
  // Record the requested per-scene length so it can be cross-checked against the
  // actual duration read back in getArkVideoTask — this is how to confirm the
  // model honours per-scene `seconds` (see the header note on seconds vs duration).
  console.log("[executor] ark video task created", { taskId: data.id, requestedSeconds: input.seconds ?? null });
  return data.id;
}

// Generate a single subject-anchor image and return its public URL (NOT bytes).
// Ark's image API (OpenAI-compatible /images/generations) returns a temporary
// signed TOS URL when `response_format: "url"`; that URL is publicly reachable,
// so Seedance can fetch it as a `reference_image` at scene-create time. We keep
// the URL instead of downloading to base64 precisely because Seedance's task API
// hangs on inline `data:` URIs (see ArkContentItem). Best-effort: callers treat
// any failure as "no anchor" and degrade to text-only scene consistency.
export async function generateArkImageUrl(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  extraBody?: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<string> {
  const url = `${arkApiRoot(input.baseUrl)}/images/generations`;
  const response = await secureProviderFetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      prompt: input.prompt,
      ...(input.extraBody ?? {}),
      // Force a URL result: a base64 image cannot be used as a Seedance
      // reference_image (it hangs the create call), so we never want b64_json.
      response_format: "url",
    }),
    signal: input.signal,
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`ark image generation failed: ${response.status} ${detail}`);
  }
  const data = (await response.json()) as { data?: Array<{ url?: string }> };
  const imageUrl = data.data?.[0]?.url;
  if (!imageUrl) throw new Error("ark image generation returned no url");
  return imageUrl;
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
    duration?: number;
    error?: unknown;
  };
  const error =
    typeof data.error === "string"
      ? data.error
      : data.error
        ? JSON.stringify(data.error).slice(0, 500)
        : undefined;
  const status = (data.status as ArkVideoStatus) ?? "unknown";
  if (status === "succeeded") {
    // Actual generated length; compare with the `requestedSeconds` logged at
    // create time to verify Seedance honoured the per-scene duration.
    console.log("[executor] ark video task succeeded", {
      taskId: input.taskId,
      actualDuration: data.duration ?? null,
    });
  }
  return {
    status,
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
