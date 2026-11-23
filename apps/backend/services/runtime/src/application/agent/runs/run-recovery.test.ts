import assert from "node:assert/strict";
import test from "node:test";

import type { TurnCapabilities } from "../runtime/types.js";
import type { ToolCatalog } from "../tools/catalog.js";
import type { OrphanedTurnRecovery, TurnResumeEnvelope } from "./repository.js";
import { resumeClaimedAgentRun, type ClaimedRecoveryDependencies, type RunAgentInput } from "./run.js";

const providerBinding = {
  id: "provider",
  model: "model",
  baseUrl: "https://provider.example/v1",
  extraBody: { store: false },
  contextWindow: 128_000,
  maxOutputTokens: 8_192,
  supportsImageInput: true,
  providerKind: "openai_responses",
} as const;

const envelope: TurnResumeEnvelope = {
  runId: "run",
  attemptEpoch: 2n,
  sessionId: "session",
  historyMessageId: "input-message",
  historyRevision: 7,
  historyDigest: "1".repeat(64),
  instructionDigest: "2".repeat(64),
  toolCatalogDigest: "3".repeat(64),
  workspaceDigest: "4".repeat(64),
  compactorVersion: "runtime-context-projection-v1",
  remoteBinding: "remote",
  snapshot: {
    schemaVersion: 2,
    execution: {
      operation: "submit-message",
      assistantMessageId: "assistant-message",
      reasoningEffort: "medium",
      approvalPolicy: "on-request",
      permissionProfile: ":workspace",
      pluginActivations: [],
      skills: [],
      generateTitle: false,
      activeSkillName: null,
      instructions: "instructions",
      providerBinding,
    },
  },
};

const recovery = (
  decision: "resume-next-step" | "regenerate-model",
): Extract<OrphanedTurnRecovery, { state: "claimed" }> => ({
  state: "claimed",
  decision,
  token: { runId: envelope.runId, attemptEpoch: envelope.attemptEpoch },
  envelope,
});

function dependencies(overrides: Partial<ClaimedRecoveryDependencies> = {}) {
  let failed = 0;
  let released = 0;
  let executed = 0;
  let drained = 0;
  let executionInput: RunAgentInput | undefined;
  let resumeLeaf: string | undefined;
  const capabilities: TurnCapabilities = {
    provider: { ...providerBinding, name: "Provider", apiKey: "secret" },
    plugins: {
      schemaVersion: 1,
      snapshotId: "snapshot",
      snapshotDigest: "0".repeat(64),
      plugins: [],
      connectionGrants: [],
    },
    skills: [],
    media: { providers: [] },
    memories: [],
  };
  const deps: ClaimedRecoveryDependencies = {
    getSession: async () => ({ id: envelope.sessionId }) as never,
    renewCapabilities: async () => capabilities,
    getRun: async () =>
      ({
        id: envelope.runId,
        sessionId: envelope.sessionId,
        outputMessageId: envelope.snapshot.execution.assistantMessageId,
      }) as never,
    execute: async (execution) => {
      executed++;
      executionInput = execution.input;
      resumeLeaf = execution.resume?.leafMessageId;
      return {
        arrayBuffer: async () => {
          drained++;
          return new ArrayBuffer(0);
        },
      };
    },
    fail: async () => {
      failed++;
    },
    release: async () => {
      released++;
    },
    ...overrides,
  };
  return {
    deps,
    state: () => ({ failed, released, executed, drained, executionInput, resumeLeaf }),
  };
}

test("claimed recovery reacquires authority, resumes the selected boundary, and drains the response", async () => {
  const { deps, state } = dependencies();
  await resumeClaimedAgentRun(recovery("resume-next-step"), {} as ToolCatalog, deps);

  assert.deepEqual(state(), {
    failed: 0,
    released: 0,
    executed: 1,
    drained: 1,
    executionInput: {
      reasoningEffort: "medium",
      capabilities: {
        provider: { ...providerBinding, name: "Provider", apiKey: "secret" },
        plugins: {
          schemaVersion: 1,
          snapshotId: "snapshot",
          snapshotDigest: "0".repeat(64),
          plugins: [],
          connectionGrants: [],
        },
        skills: [],
        media: { providers: [] },
        memories: [],
      },
      trigger: "submit-message",
      expectedRevision: 7,
      requestId: "recovery-run-2",
      generateTitle: false,
    },
    resumeLeaf: "assistant-message",
  });
});

test("provider generation drift fails before SDK re-entry and releases the claimed attempt", async () => {
  const { deps, state } = dependencies({
    renewCapabilities: async () => ({
      provider: { ...providerBinding, name: "Provider", apiKey: "secret", baseUrl: "https://changed.example/v1" },
      plugins: {
        schemaVersion: 1,
        snapshotId: "snapshot",
        snapshotDigest: "0".repeat(64),
        plugins: [],
        connectionGrants: [],
      },
      skills: [],
      media: { providers: [] },
      memories: [],
    }),
  });

  await assert.rejects(
    resumeClaimedAgentRun(recovery("regenerate-model"), {} as ToolCatalog, deps),
    /provider binding changed/,
  );
  assert.deepEqual(state(), {
    failed: 1,
    released: 1,
    executed: 0,
    drained: 0,
    executionInput: undefined,
    resumeLeaf: undefined,
  });
});

test("production recovery fails closed without a renewed upper-host capability", async () => {
  const { deps, state } = dependencies({
    renewCapabilities: async () => {
      throw new Error("turn recovery requires a renewed upper-host capability");
    },
  });
  await assert.rejects(
    resumeClaimedAgentRun(recovery("regenerate-model"), {} as ToolCatalog, deps),
    /renewed upper-host capability/,
  );
  assert.equal(state().failed, 1);
  assert.equal(state().released, 1);
  assert.equal(state().executed, 0);
});

test("response drain failure terminalizes and releases the recovered attempt", async () => {
  const { deps, state } = dependencies({
    execute: async () => ({
      arrayBuffer: async () => {
        throw new Error("stream failed");
      },
    }),
  });

  await assert.rejects(resumeClaimedAgentRun(recovery("regenerate-model"), {} as ToolCatalog, deps), /stream failed/);
  assert.equal(state().failed, 1);
  assert.equal(state().released, 1);
});
