// Only the markdown generation timeout remains here. HTML generation's
// concurrency/worker/poll constants moved to the executor service along with
// the pipeline they configured.
export const ARTIFACT_GENERATION_TIMEOUT = {
  totalMs: 30 * 60_000,
  stepMs: 30 * 60_000,
  chunkMs: 5 * 60_000,
} as const;
