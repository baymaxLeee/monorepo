import type { ExecutionEnvironment } from "@repo/agent-runtime/runtime/environment";
import { createExecutionHostManifests } from "@repo/agent-runtime/runtime/execution-host";

import { artifactToolContextSchema } from "../tools/context.js";
import { requireRunSandbox } from "./cloud-sandbox.js";

export const CLOUD_EXECUTION_ENVIRONMENT = {
  location: "cloud",
  workspace: {
    root: "/workspace",
    access: "read-write",
    isolation: "ephemeral",
    persistence: "session",
    externalSources: "read-only",
  },
  network: { access: "environment", protocols: ["http", "https"] },
  process: { shell: true, lifetime: "command", backgroundServices: "unsupported" },
  deliverables: "session-file",
  approvals: "policy",
} as const satisfies ExecutionEnvironment;

export async function createCloudToolAdapters() {
  const manifests = createExecutionHostManifests(
    {
      environment: CLOUD_EXECUTION_ENVIRONMENT,
      run: async (input, options) => {
        options.abortSignal?.throwIfAborted();
        return requireRunSandbox(options.experimental_sandbox).run({
          command: input.command,
          workingDirectory: input.workdir ?? "/workspace/work",
          timeoutMs: input.timeout_ms,
          abortSignal: options.abortSignal,
        });
      },
      refreshSources: (options) => requireRunSandbox(options.experimental_sandbox).refresh(options.abortSignal),
      deliver: (input, options) =>
        requireRunSandbox(options.experimental_sandbox).save(input, options.toolCallId, options.abortSignal),
    },
    { contextSchema: artifactToolContextSchema },
  );
  return { environment: CLOUD_EXECUTION_ENVIRONMENT, manifests, dispose: async () => {} };
}
