import { listClaimableArtifactGenerations } from "../../../clients/knowledge.js";
import { ARTIFACT_WORKER_POOL_SIZE, ARTIFACT_WORKER_POLL_MS } from "../config.js";
import { processClaimableArtifactJob } from "./generation-runner.js";

let started = false;
const activeJobs = new Set<string>();

export function startArtifactWorkerPool(): void {
  if (started) return;
  started = true;
  console.info("[artifact-worker] starting pool", {
    size: ARTIFACT_WORKER_POOL_SIZE,
    pollMs: ARTIFACT_WORKER_POLL_MS,
  });
  void pollClaimableJobs();
}

async function pollClaimableJobs(): Promise<void> {
  while (started) {
    try {
      const jobs = await listClaimableArtifactGenerations({
        limit: ARTIFACT_WORKER_POOL_SIZE * 2,
      });
      const available = ARTIFACT_WORKER_POOL_SIZE - activeJobs.size;
      for (const job of jobs.slice(0, Math.max(0, available))) {
        if (activeJobs.has(job.id)) continue;
        activeJobs.add(job.id);
        void processClaimableArtifactJob(job).finally(() => {
          activeJobs.delete(job.id);
        });
      }
    } catch (error) {
      console.error("[artifact-worker] poll failed", error);
    }
    await new Promise((resolve) => setTimeout(resolve, ARTIFACT_WORKER_POLL_MS));
  }
}

export function stopArtifactWorkerPool(): void {
  started = false;
}
