// Volcengine Ark video generation (Seedance) client. Ark video is an
// asynchronous task API — create a task, then poll it to a terminal state —
// which is why it lives behind a durable executor workflow rather than an
// inline chat tool (ADR-0014). All outbound calls go through secureProviderFetch
// (SSRF guard + no redirects), the same guard chat/executor use for every
// admin-configured provider URL.
import { secureProviderFetch } from "@backend/transport-ts/provider-url";

import { clampArkDuration } from "../video/limits.js";

const VIDEO_TASKS_PATH = "/contents/generations/tasks";

// Seedance model capability descriptor. The ONLY place model-version wire
// differences live, so bumping the pipeline from Seedance 2.0 to 2.5 (or back
// to a legacy 1.x provider) is one match arm here, never an architecture change
// (ADR-0018 update 2026-07). Keyed by the admin-configured model id.
export interface SeedanceCaps {
  // Hard per-generation length ceiling. A single 2.x generation renders a whole
  // multi-shot SEGMENT (not one shot), so this is the segment budget too.
  maxClipSeconds: number;
  // Native duration wire format. 2.x uses an integer top-level `duration`
  // (4–15, or -1 for auto). A legacy "new-api" gateway used a `seconds` STRING.
  durationField: "duration" | "seconds";
  // 2.x accepts up to 9 `reference_image` items addressable as @image1..N in the
  // prompt (multi-character lock). 1.x had at most a single reference image.
  multiImageReference: boolean;
  // 2.x can return the final frame (`return_last_frame`) for last-frame → next
  // first-frame continuation ("接着拍").
  returnLastFrame: boolean;
}

export function seedanceCaps(model: string): SeedanceCaps {
  const m = (model ?? "").toLowerCase();
  // Seedance 2.x family (matches doubao-seedance-2-0-*, -2.0-*, and forward
  // -2-5-* / -2.5-*): native multi-shot, multi-image @reference, native audio.
  if (/seedance[-_ ]?2([-_.]|$)/.test(m)) {
    return {
      maxClipSeconds: 15,
      durationField: "duration",
      multiImageReference: true,
      returnLastFrame: true,
    };
  }
  // Legacy fallback (Seedance 1.x / unknown): conservative single-reference,
  // string seconds, no last-frame return.
  return {
    maxClipSeconds: 10,
    durationField: "seconds",
    multiImageReference: false,
    returnLastFrame: false,
  };
}

// A failed Ark HTTP call, classified for the durable workflow's retry policy.
// `retryable` is true for transient faults (429 rate limit, 5xx, network/timeout
// surfaced as a non-HTTP throw) — the caller should let these propagate so
// Workflow DevKit retries the step. It is false for a 4xx the model will reject
// again identically (bad params, content moderation), which should degrade that
// one segment instead of burning retries.
export class ArkRequestError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  constructor(status: number, detail: string) {
    super(`ark request failed: ${status} ${detail}`.trim());
    this.name = "ArkRequestError";
    this.status = status;
    this.retryable = status === 429 || status >= 500;
  }
}

// We allowlist the documented native params and map common config aliases, so a
// stray extra_body key (e.g. the admin test-only `test_poll_seconds`) can no
// longer 400 the request. Per-request values built in createArkVideoTask are
// spread AFTER these, so they win over any admin extra_body default.
// `camera_fixed` was a Seedance 1.x knob the 2.x series dropped, so it is
// intentionally not allowlisted (2.x ignores it — keep it out).
// `duration`/`seconds` are intentionally NOT allowlisted: clip length is owned
// per-segment by the pipeline (createArkVideoTask sends the model's native
// duration field itself). Passing through an admin default here would either
// fight the per-segment value or, worse, pin every segment to one fixed length —
// exactly the `"seconds": "5"` bug that pinned 2.x reels to 5s.
const ARK_VIDEO_PARAMS = new Set([
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
  // Present only when the task was created with returnLastFrame + the model
  // supports it; the URL of the generated clip's final frame, used to seed the
  // next segment as a first_frame for seamless continuation.
  lastFrameUrl?: string;
  error?: string;
}

// A reference image attached to a generation, with its Seedance role. All URLs
// MUST be reachable public HTTP(S) URLs (see ArkContentItem note). The three
// image-bearing scenarios are mutually exclusive per task:
//   - reference_image(s): multimodal @reference, loose multi-subject lock;
//   - first_frame [+ last_frame]: image-to-video, exact frame lock (used for
//     last-frame chaining continuity).
export type ArkImageRole = "reference_image" | "first_frame" | "last_frame";
export interface ArkImageRef {
  url: string;
  role: ArkImageRole;
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
    options[key] = rawValue;
  }
  return options;
}

// Ark native video content item. Text is always present; zero or more images can
// be attached with a `role` (reference_image / first_frame / last_frame).
//
// IMPORTANT: `image_url.url` MUST be a reachable public HTTP(S) URL — Seedance's
// native task API hangs indefinitely (no response, no error) when given a base64
// `data:` URI here, which manifests downstream as every create call timing out.
// Always pass a URL (e.g. the character-sheet image's Ark/TOS URL), not inline
// base64.
type ArkContentItem =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string }; role: ArkImageRole };

// Defaults tuned for vertical short-drama (抖音/小红书 投流): portrait 9:16,
// 720p, native audio on. Each is only a default — an admin `extra_body` value
// (mapped through videoBodyOptions) overrides it, and the per-request fields
// built below win last of all.
const ARK_VIDEO_DEFAULTS = {
  ratio: "9:16",
  resolution: "720p",
  generate_audio: true,
} as const;

export async function createArkVideoTask(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  // The (timecoded, multi-shot) prompt text for this segment.
  prompt: string;
  // Zero or more reference images with roles. reference_image items are
  // addressable as @image1..N in the prompt (2.x). first_frame/last_frame drive
  // image-to-video continuity. The three modes are mutually exclusive, enforced
  // by the caller (buildSegmentContent).
  images?: ArkImageRef[];
  // Desired segment length in whole seconds. Always sent in the model's native
  // duration field (integer `duration` for 2.x, string `seconds` for legacy 1.x),
  // clamped to the model's real 4–15 range. The official 2.x API accepts an
  // explicit duration in EVERY mode, including reference mode — there is no
  // "strip duration in reference mode" special case (ADR-0018 2026-07 fix).
  seconds?: number;
  // Fixed seed for this generation (per-segment derived; see the workflow).
  seed?: number;
  // Ask Ark to return the clip's final frame for last-frame chaining.
  returnLastFrame?: boolean;
  extraBody: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<string> {
  const caps = seedanceCaps(input.model);
  const url = `${arkApiRoot(input.baseUrl)}${VIDEO_TASKS_PATH}`;

  const images = input.images ?? [];
  const content: ArkContentItem[] = [{ type: "text", text: input.prompt }];
  for (const image of images) {
    content.push({ type: "image_url", image_url: { url: image.url }, role: image.role });
  }

  const inReferenceMode = images.some((image) => image.role === "reference_image");
  // Clip length is ALWAYS sent (clamped to the model's integer range) in the
  // native duration field — this is the single source of truth for length now
  // that segments are one continuous action with no in-prompt timecodes.
  const durationSeconds = clampArkDuration(input.seconds);
  const durationValue =
    caps.durationField === "duration" ? durationSeconds : String(durationSeconds);

  const body: Record<string, unknown> = {
    model: input.model,
    content,
    ...ARK_VIDEO_DEFAULTS,
    ...videoBodyOptions(input.extraBody),
    ...(input.seed != null ? { seed: input.seed } : {}),
    [caps.durationField]: durationValue,
    ...(input.returnLastFrame && caps.returnLastFrame ? { return_last_frame: true } : {}),
  };

  const response = await secureProviderFetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: input.signal,
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new ArkRequestError(response.status, detail);
  }
  const data = (await response.json()) as { id?: string };
  if (!data.id) throw new Error("ark create video task returned no task id");
  // Record the requested length + mode so it can be cross-checked against the
  // actual duration read back in getArkVideoTask — this is how to confirm the
  // model honours (or auto-picks) the segment length under each mode.
  console.log("[executor] ark video task created", {
    taskId: data.id,
    requestedSeconds: input.seconds ?? null,
    durationSent: durationValue,
    referenceImages: images.filter((i) => i.role === "reference_image").length,
    mode: inReferenceMode
      ? "reference"
      : images.some((i) => i.role === "first_frame")
        ? "first-last-frame"
        : "text",
  });
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
    content?: { video_url?: string; last_frame_url?: string } | null;
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
    // create time to verify Seedance honoured (or auto-picked) the length.
    console.log("[executor] ark video task succeeded", {
      taskId: input.taskId,
      actualDuration: data.duration ?? null,
      hasLastFrame: Boolean(data.content?.last_frame_url),
    });
  }
  return {
    status,
    videoUrl: data.content?.video_url,
    lastFrameUrl: data.content?.last_frame_url,
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
