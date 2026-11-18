import assert from "node:assert/strict";
import test from "node:test";

import type { ExecutionEnvironment } from "./execution-environment.js";
import { createExecutionHostManifests } from "./execution-host.js";

const environment = {
  location: "local",
  workspace: {
    root: "/project",
    access: "read-write",
    isolation: "direct",
    persistence: "host",
    externalSources: "unavailable",
  },
  network: { access: "public", protocols: ["http", "https"] },
  process: { shell: true, lifetime: "command", backgroundServices: "unsupported" },
  deliverables: "workspace-reference",
  approvals: "auto",
} as const satisfies ExecutionEnvironment;

const published = {
  file_id: "a".repeat(32),
  filename: "result.txt",
  title: "result.txt",
  media_type: "text/plain",
  kind: "artifact",
  etag: `"${"b".repeat(32)}"`,
  updated: false,
};

test("execution hosts share one shell and deliverable manifest set", () => {
  const manifests = createExecutionHostManifests({
    environment,
    run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    deliver: async () => published,
  });
  assert.deepEqual(
    manifests.map((manifest) => manifest.name),
    ["bash", "upload_artifacts"],
  );
});

test("source refresh is an optional host capability", () => {
  const manifests = createExecutionHostManifests({
    environment: {
      ...environment,
      location: "cloud",
      workspace: {
        ...environment.workspace,
        root: "/workspace",
        isolation: "ephemeral",
        persistence: "session",
        externalSources: "read-only",
      },
    },
    run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    deliver: async () => published,
    refreshSources: async () => ({ sources: [] }),
  });
  assert.deepEqual(
    manifests.map((manifest) => manifest.name),
    ["bash", "refresh_session_sources", "upload_artifacts"],
  );
});

test("host callbacks cannot contradict the advertised environment", () => {
  assert.throws(
    () =>
      createExecutionHostManifests({
        environment,
        run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        deliver: async () => published,
        refreshSources: async () => ({ sources: [] }),
      }),
    /must match the advertised external source capability/,
  );
});
