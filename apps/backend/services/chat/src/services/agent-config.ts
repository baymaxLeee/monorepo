export const MAX_AGENT_STEPS = 12;

export const ARTIFACT_GENERATION_TIMEOUT = {
  totalMs: 8 * 60_000,
  stepMs: 8 * 60_000,
  chunkMs: 45_000,
} as const;

export const ARTIFACT_STREAM_NAMESPACE = "artifact";
export const ARTIFACT_STREAM_MIN_DELTA_CHARS = 512;
export const ARTIFACT_PREVIEW_MAX_CHARS = 4_000;
export const ARTIFACT_CHUNKED_REVISION_THRESHOLD = 24_000;
export const ARTIFACT_REVISION_CHUNK_CHARS = 12_000;
