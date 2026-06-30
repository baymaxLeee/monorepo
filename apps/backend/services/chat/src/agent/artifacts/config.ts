export const ARTIFACT_GENERATION_TIMEOUT = {
  totalMs: 30 * 60_000,
  stepMs: 30 * 60_000,
  chunkMs: 5 * 60_000,
} as const;

export const ARTIFACT_GENERATION_CONCURRENCY = 4;
export const ARTIFACT_WORKER_POOL_SIZE = 2;
export const ARTIFACT_WORKER_POLL_MS = 3_000;
export const ARTIFACT_GENERATION_POLL_MS = 2_000;

export function useArtifactSyncGeneration(): boolean {
  return process.env.ARTIFACT_SYNC_GENERATION === "true";
}

