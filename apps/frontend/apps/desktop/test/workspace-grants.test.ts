import { describe, expect, it } from "vitest";

import { WorkspaceGrants } from "../electron/workspace-grants";

describe("WorkspaceGrants", () => {
  it("accepts existing projects without consuming their authorization", () => {
    const grants = new WorkspaceGrants();
    expect(grants.authorize("/project", ["/project"])).toBe(true);
    expect(grants.authorize("/project", ["/project"])).toBe(true);
  });

  it("accepts a native selection once and rejects arbitrary paths", () => {
    const grants = new WorkspaceGrants();
    grants.grant("/selected");
    expect(grants.authorize("/selected", [])).toBe(true);
    expect(grants.authorize("/selected", [])).toBe(false);
    expect(grants.authorize("/arbitrary", [])).toBe(false);
  });

  it("revokes pending selections when the identity changes", () => {
    const grants = new WorkspaceGrants();
    grants.grant("/selected");
    grants.clear();
    expect(grants.authorize("/selected", [])).toBe(false);
  });
});
