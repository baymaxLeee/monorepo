export const MAX_AGENT_STEPS = 256;
export const MAX_AGENT_OUTPUT_TOKENS = 65_536;

export const MAX_MEMORY_CANDIDATES_PER_RUN = 5;

export const MAX_INJECTED_MEMORIES = 24;
export const MAX_INJECTED_MEMORY_CHARS = 4_000;

export const ARTIFACT_GENERATION_TIMEOUT = {
  totalMs: 30 * 60_000,
  stepMs: 30 * 60_000,
  chunkMs: 5 * 60_000,
} as const;

export const ARTIFACT_MODEL_OUTPUT_TOKENS = 65_536;
export const ARTIFACT_GENERATION_CONCURRENCY = 4;
