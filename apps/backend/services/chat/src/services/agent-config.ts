export const MAX_AGENT_STEPS = 12;

export const MAX_MEMORY_CANDIDATES_PER_RUN = 5;

export const MAX_INJECTED_MEMORIES = 24;
export const MAX_INJECTED_MEMORY_CHARS = 4_000;

export const ARTIFACT_GENERATION_TIMEOUT = {
  totalMs: 8 * 60_000,
  stepMs: 8 * 60_000,
  chunkMs: 45_000,
} as const;

export const ARTIFACT_CHUNKED_REVISION_THRESHOLD = 24_000;
export const ARTIFACT_REVISION_CHUNK_CHARS = 12_000;
