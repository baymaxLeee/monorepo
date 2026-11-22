import assert from "node:assert/strict";
import test from "node:test";

import { canonicalizeShellCommand, ExecPolicy } from "./exec-policy.js";
import { compilePermissionProfile, type PermissionProfile } from "./permissions.js";

const workspace = compilePermissionProfile(":workspace", { workspaceRoot: "/workspace" }).profile;
const fullAccess = compilePermissionProfile(":danger-full-access", { workspaceRoot: "/workspace" }).profile;

test("shell lowering evaluates canonical argv segments instead of raw command substrings", () => {
  assert.deepEqual(canonicalizeShellCommand(`printf '%s\\n' "curl is text" && git status --short`), {
    argv: ["/bin/bash", "--noprofile", "--norc", "-c", `printf '%s\\n' "curl is text" && git status --short`],
    commands: [
      ["printf", "%s\\n", "curl is text"],
      ["git", "status", "--short"],
    ],
    analyzable: true,
  });
  assert.equal(canonicalizeShellCommand("printf '%s' \"$(id)\"").analyzable, false);
});

test("prefix rules match whole argv tokens and reject dangerously broad reusable allows", () => {
  const policy = new ExecPolicy([{ prefix: ["git", "status"], decision: "allow" }]);
  assert.equal(policy.evaluateCommand(["git", "status", "--short"]).decision, "allow");
  assert.equal(policy.evaluateCommand(["git", "statusx"]).matchedRule, null);
  assert.throws(() => new ExecPolicy([{ prefix: ["git"], decision: "allow" }]), /too broad/);
  assert.throws(() => new ExecPolicy([{ prefix: ["bash", "-c"], decision: "allow" }]), /too broad/);
});

test("approval policies map Codex exec decisions without changing the sandbox profile", () => {
  const policy = new ExecPolicy();
  assert.deepEqual(
    policy.requirement({
      command: "rg TODO src",
      approvalPolicy: "on-request",
      permissionProfile: workspace,
      sandboxPermissions: "use_default",
    }),
    { type: "skip", bypassSandbox: false, reason: null },
  );
  assert.equal(
    policy.requirement({
      command: "rg TODO src",
      approvalPolicy: "unless-trusted",
      permissionProfile: workspace,
      sandboxPermissions: "use_default",
    }).type,
    "needs-approval",
  );
  assert.equal(
    policy.requirement({
      command: "rm -rf build",
      approvalPolicy: "never",
      permissionProfile: workspace,
      sandboxPermissions: "use_default",
    }).type,
    "forbidden",
  );
  const human = new ExecPolicy([{ prefix: ["deploy", "prod"], decision: "prompt-user" }]).requirement({
    command: "deploy prod",
    approvalPolicy: "granular",
    permissionProfile: workspace,
    sandboxPermissions: "use_default",
  });
  assert.equal(human.type, "needs-human-approval");
});

test("never with full access ignores redundant sandbox escalation for non-dangerous shell commands", () => {
  const policy = new ExecPolicy();
  const command = `target=$(rg --files src | head -n 1); printf '%s\\n' "$target"`;

  assert.deepEqual(
    policy.requirement({
      command,
      approvalPolicy: "never",
      permissionProfile: fullAccess,
      sandboxPermissions: "use_default",
    }),
    { type: "skip", bypassSandbox: false, reason: null },
  );
  assert.deepEqual(
    policy.requirement({
      command: "rm -f tests/test_ttl_cache.py.new",
      approvalPolicy: "never",
      permissionProfile: fullAccess,
      sandboxPermissions: "use_default",
    }),
    { type: "skip", bypassSandbox: false, reason: null },
  );
  assert.deepEqual(
    policy.requirement({
      command,
      approvalPolicy: "never",
      permissionProfile: fullAccess,
      sandboxPermissions: "with_additional_permissions",
      additionalPermissions: {
        file_system: { write: ["/tmp/generated"] },
        network: { enabled: true },
      },
    }),
    { type: "skip", bypassSandbox: false, reason: null },
  );
  assert.equal(
    policy.requirement({
      command: "rm -rf build",
      approvalPolicy: "never",
      permissionProfile: fullAccess,
      sandboxPermissions: "use_default",
    }).type,
    "forbidden",
  );
  assert.equal(
    policy.requirement({
      command: `for target in build cache; do rm -rf "$target"; done`,
      approvalPolicy: "never",
      permissionProfile: fullAccess,
      sandboxPermissions: "use_default",
    }).type,
    "forbidden",
  );
  assert.equal(
    policy.requirement({
      command: `printf '%s\\n' "$(rm -rf build)"`,
      approvalPolicy: "never",
      permissionProfile: fullAccess,
      sandboxPermissions: "use_default",
    }).type,
    "forbidden",
  );
});

test("explicit allow cannot bypass sandbox while the profile contains denied reads", () => {
  const denyRead: PermissionProfile = {
    type: "managed",
    fileSystem: {
      type: "restricted",
      entries: [
        { path: "/", access: "read" },
        { path: "/workspace", access: "write" },
        { path: "/private", access: "deny" },
      ],
    },
    network: { type: "restricted", allowedHosts: [] },
  };
  const requirement = new ExecPolicy([
    { prefix: ["tool", "inspect"], decision: "allow", bypassSandbox: true },
  ]).requirement({
    command: "tool inspect item",
    approvalPolicy: "on-request",
    permissionProfile: denyRead,
    sandboxPermissions: "use_default",
  });
  assert.deepEqual(requirement, { type: "skip", bypassSandbox: false, reason: null });
});

test("allow rules keep the sandbox unless bypass is explicit", () => {
  const policy = new ExecPolicy([{ prefix: ["tool", "inspect"], decision: "allow" }]);
  assert.deepEqual(
    policy.requirement({
      command: "tool inspect item",
      approvalPolicy: "on-request",
      permissionProfile: workspace,
      sandboxPermissions: "use_default",
    }),
    { type: "skip", bypassSandbox: false, reason: null },
  );
});
