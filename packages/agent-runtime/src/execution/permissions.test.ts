import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAdditionalPermissions,
  compilePermissionProfile,
  permissionProfileHasDeniedReads,
  type PermissionProfile,
} from "./permissions.js";

test("built-in permission profiles compile to runtime enforcement variants", () => {
  const readOnly = compilePermissionProfile(":read-only", { workspaceRoot: "/workspace" });
  const workspace = compilePermissionProfile(":workspace", { workspaceRoot: "/workspace" });
  const danger = compilePermissionProfile(":danger-full-access", { workspaceRoot: "/workspace" });

  assert.equal(readOnly.profile.type, "managed");
  assert.equal(workspace.profile.type, "managed");
  assert.equal(danger.profile.type, "disabled");
  if (workspace.profile.type !== "managed" || workspace.profile.fileSystem.type !== "restricted") {
    throw new Error("workspace profile must be managed and restricted");
  }
  assert.deepEqual(workspace.profile.fileSystem.entries, [
    { path: "/", access: "read" },
    { path: "/workspace", access: "write" },
  ]);
  assert.deepEqual(workspace.profile.network, { type: "restricted", allowedHosts: [] });
});

test("additional permissions never weaken an existing denied read", () => {
  const profile: PermissionProfile = {
    type: "managed",
    fileSystem: {
      type: "restricted",
      entries: [
        { path: "/", access: "read" },
        { path: "/workspace", access: "write" },
        { path: "/workspace/secrets", access: "deny" },
      ],
    },
    network: { type: "restricted", allowedHosts: [] },
  };

  assert.equal(permissionProfileHasDeniedReads(profile), true);
  const expanded = applyAdditionalPermissions(profile, {
    file_system: { write: ["/workspace/secrets"] },
    network: { enabled: true },
  });
  assert.equal(permissionProfileHasDeniedReads(expanded), true);
  assert.deepEqual(expanded, {
    type: "managed",
    fileSystem: {
      type: "restricted",
      entries: [
        { path: "/", access: "read" },
        { path: "/workspace", access: "write" },
        { path: "/workspace/secrets", access: "deny" },
      ],
    },
    network: { type: "enabled" },
  });
});

test("network additions survive an already-unrestricted filesystem", () => {
  const expanded = applyAdditionalPermissions(
    {
      type: "managed",
      fileSystem: { type: "unrestricted" },
      network: { type: "restricted", allowedHosts: [] },
    },
    {
      file_system: { write: ["/workspace"] },
      network: { enabled: true },
    },
  );

  assert.deepEqual(expanded, {
    type: "managed",
    fileSystem: { type: "unrestricted" },
    network: { type: "enabled" },
  });
});

test("additional permissions are redundant when sandbox enforcement is disabled", () => {
  assert.deepEqual(
    applyAdditionalPermissions(
      { type: "disabled" },
      {
        file_system: { write: ["/tmp/generated"] },
        network: { enabled: true },
      },
    ),
    { type: "disabled" },
  );
});

test("permission profiles normalize conflicts and reject invalid authorities", () => {
  const profile = compilePermissionProfile("custom", {
    workspaceRoot: "/workspace",
    profiles: {
      custom: {
        type: "managed",
        fileSystem: {
          type: "restricted",
          entries: [
            { path: "/workspace/secret", access: "read" },
            { path: "/workspace", access: "write" },
            { path: "/workspace/secret", access: "deny" },
          ],
        },
        network: { type: "restricted", allowedHosts: ["API.EXAMPLE.COM.", "api.example.com"] },
      },
    },
  }).profile;
  assert.deepEqual(profile, {
    type: "managed",
    fileSystem: {
      type: "restricted",
      entries: [
        { path: "/workspace", access: "write" },
        { path: "/workspace/secret", access: "deny" },
      ],
    },
    network: { type: "restricted", allowedHosts: ["api.example.com"] },
  });
  assert.throws(
    () =>
      compilePermissionProfile("invalid", {
        workspaceRoot: "/workspace",
        profiles: {
          invalid: {
            type: "managed",
            fileSystem: { type: "restricted", entries: [{ path: "relative", access: "read" }] },
            network: { type: "restricted", allowedHosts: [] },
          },
        },
      }),
    /permission path must be absolute/,
  );
});
