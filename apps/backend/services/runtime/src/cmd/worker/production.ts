import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const managedShutdown = process.env.WORKFLOW_POSTGRES_APPLICATION_MANAGED_SHUTDOWN;
if (managedShutdown && managedShutdown !== "1") {
  throw new Error("WORKFLOW_POSTGRES_APPLICATION_MANAGED_SHUTDOWN must be 1");
}
process.env.WORKFLOW_POSTGRES_APPLICATION_MANAGED_SHUTDOWN = "1";
process.env.WORKFLOW_POSTGRES_JOB_LOCK_STALE_SECONDS ??= "30";
process.env.RUNTIME_WORKER_HTTP_OWNER = "nitro";

await import(pathToFileURL(resolve(".output/server/index.mjs")).href);
