import { describe, expect, it } from "vitest";

import { authorizationModeFromExecutionPolicy, executionPolicyForAuthorizationMode } from "./ExecutionPolicy";

describe("authorization mode presets", () => {
  it.each([
    ["ask-for-approval", "on-request", ":workspace"],
    ["approve-for-me", "granular", ":workspace"],
    ["full-access", "never", ":danger-full-access"],
  ] as const)("maps %s to one runtime policy pair", (mode, approvalPolicy, permissionProfile) => {
    const policy = executionPolicyForAuthorizationMode(mode);
    expect(policy).toEqual({ approvalPolicy, permissionProfile });
    expect(authorizationModeFromExecutionPolicy(policy)).toBe(mode);
  });

  it("presents legacy or custom policy pairs as the conservative approval mode", () => {
    expect(
      authorizationModeFromExecutionPolicy({ approvalPolicy: "unless-trusted", permissionProfile: ":read-only" }),
    ).toBe("ask-for-approval");
  });
});
