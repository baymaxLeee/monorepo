import { secureProviderFetch } from "@backend/transport-ts/provider-url";

import { clampArkDuration } from "../../application/video/limits.js";
import { pickArkVideoBody } from "../../application/video/output-config.js";

const VIDEO_TASKS_PATH = "/contents/generations/tasks";

export interface SeedanceCaps {
  maxClipSeconds: number;
  durationField: "duration" | "seconds";
  multiImageReference: boolean;
}

export function seedanceCaps(model: string): SeedanceCaps {
  const m = (model ?? "").toLowerCase();
  if (/seedance[-_ ]?2([-_.]|$)/.test(m)) {
    return {
      maxClipSeconds: 15,
      durationField: "duration",
      multiImageReference: true,
    };
  }
  return {
    maxClipSeconds: 10,
    durationField: "seconds",
    multiImageReference: false,
  };
}

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

export type ArkImageRole = "reference_image";
export interface ArkImageRef {
  url: string;
  role: ArkImageRole;
}

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

type ArkContentItem =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string }; role: ArkImageRole };

export async function createArkVideoTask(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  images?: ArkImageRef[];
  seconds?: number;
  seed?: number;
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
  const durationSeconds = clampArkDuration(input.seconds);
  const durationValue =
    caps.durationField === "duration" ? durationSeconds : String(durationSeconds);

  const body: Record<string, unknown> = {
    model: input.model,
    content,
    ...pickArkVideoBody(input.extraBody),
    ...(input.seed != null ? { seed: input.seed } : {}),
    [caps.durationField]: durationValue,
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
  console.log("[executor] ark video task created", {
    taskId: data.id,
    requestedSeconds: input.seconds ?? null,
    durationSent: durationValue,
    referenceImages: images.filter((i) => i.role === "reference_image").length,
    mode: inReferenceMode ? "reference" : "text",
  });
  return data.id;
}

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

export async function deleteArkVideoTask(input: {
  baseUrl: string;
  apiKey: string;
  taskId: string;
  signal?: AbortSignal;
}): Promise<void> {
  const url = `${arkApiRoot(input.baseUrl)}${VIDEO_TASKS_PATH}/${encodeURIComponent(input.taskId)}`;
  const response = await secureProviderFetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${input.apiKey}` },
    signal: input.signal,
  });
  if (!response.ok && response.status !== 404) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`ark cancel video task failed: ${response.status} ${detail}`);
  }
}
