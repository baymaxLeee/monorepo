export const DEFAULT_VIDEO_RATIO = "9:16";
export const DEFAULT_VIDEO_RESOLUTION = "720p";
export const DEFAULT_VIDEO_FPS = 24;
export const DEFAULT_VIDEO_GENERATE_AUDIO = true;
export const DEFAULT_VIDEO_WATERMARK = false;

const RESOLUTION_SHORT_SIDE: Record<string, number> = {
  "480p": 480,
  "720p": 720,
  "1080p": 1080,
};

const SUPPORTED_RATIOS = new Set(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]);
const SUPPORTED_FPS = new Set([24, 25, 30, 60]);

export type VideoOutputConfig = {
  ratio: string;
  resolution: string;
  generateAudio: boolean;
  watermark: boolean;
  fps: number;
  width: number;
  height: number;
  aspectLabel: string;
};

export const ARK_VIDEO_BODY_KEYS = new Set([
  "ratio",
  "resolution",
  "framespersecond",
  "watermark",
  "generate_audio",
  "seed",
  "size",
  "service_tier",
  "tools",
  "camera_fixed",
  "draft",
]);

export const ARK_VIDEO_BODY_ALIASES: Record<string, string> = {
  fps: "framespersecond",
};

function parseRatio(ratio: string): [number, number] {
  const [rawW, rawH] = ratio.split(":");
  const w = Number(rawW);
  const h = Number(rawH);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return [9, 16];
  }
  return [w, h];
}

function even(n: number): number {
  const rounded = Math.max(2, Math.round(n));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

export function normalizeVideoRatio(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_VIDEO_RATIO;
  }
  const trimmed = value.trim();
  return SUPPORTED_RATIOS.has(trimmed) ? trimmed : DEFAULT_VIDEO_RATIO;
}

export function normalizeVideoResolution(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_VIDEO_RESOLUTION;
  }
  const normalized = value.trim().toLowerCase();
  return normalized in RESOLUTION_SHORT_SIDE ? normalized : DEFAULT_VIDEO_RESOLUTION;
}

export function resolveVideoDimensions(ratio: string, resolution: string): { width: number; height: number } {
  const shortSide = RESOLUTION_SHORT_SIDE[normalizeVideoResolution(resolution)] ?? 720;
  const [w, h] = parseRatio(normalizeVideoRatio(ratio));
  if (w < h) {
    const width = even(shortSide);
    const height = even((width * h) / w);
    return { width, height };
  }
  const height = even(shortSide);
  const width = even((height * w) / h);
  return { width, height };
}

function aspectLabel(ratio: string): string {
  const [w, h] = parseRatio(ratio);
  if (w < h) {
    return `Vertical ${ratio}`;
  }
  if (w > h) {
    return `Horizontal ${ratio}`;
  }
  return `Square ${ratio}`;
}

function readFps(extraBody: Record<string, unknown>): number {
  const raw = extraBody.framespersecond ?? extraBody.fps;
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  const fps = Math.round(parsed);
  return Number.isFinite(parsed) && SUPPORTED_FPS.has(fps) ? fps : DEFAULT_VIDEO_FPS;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

export function parseVideoOutputConfig(extraBody: Record<string, unknown> = {}): VideoOutputConfig {
  const ratio = normalizeVideoRatio(extraBody.ratio);
  const resolution = normalizeVideoResolution(extraBody.resolution);
  const { width, height } = resolveVideoDimensions(ratio, resolution);
  return {
    ratio,
    resolution,
    generateAudio: readBoolean(extraBody.generate_audio, DEFAULT_VIDEO_GENERATE_AUDIO),
    watermark: readBoolean(extraBody.watermark, DEFAULT_VIDEO_WATERMARK),
    fps: readFps(extraBody),
    width,
    height,
    aspectLabel: aspectLabel(ratio),
  };
}

export function pickArkVideoBody(extraBody: Record<string, unknown>): Record<string, unknown> {
  const config = parseVideoOutputConfig(extraBody);
  const passthrough: Record<string, unknown> = {};
  const coreKeys = new Set(["ratio", "resolution", "generate_audio", "watermark", "framespersecond", "fps"]);
  for (const [rawKey, rawValue] of Object.entries(extraBody)) {
    const key = ARK_VIDEO_BODY_ALIASES[rawKey] ?? rawKey;
    if (!ARK_VIDEO_BODY_KEYS.has(key) || coreKeys.has(key)) {
      continue;
    }
    passthrough[key] = rawValue;
  }
  return {
    ratio: config.ratio,
    resolution: config.resolution,
    generate_audio: config.generateAudio,
    watermark: config.watermark,
    framespersecond: config.fps,
    ...passthrough,
  };
}
