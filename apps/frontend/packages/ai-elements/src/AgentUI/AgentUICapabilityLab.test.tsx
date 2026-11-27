import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createAgent } from "@ui-sdk/react/agent";
import { beforeAll, expect, test } from "vitest";

import { AgentUICapabilityLab } from "./AgentUICapabilityLab";
import { createWorkspaceBridge } from "./bridge";

const testAgent = createAgent({ allow: () => true });

beforeAll(() => {
  Object.defineProperty(Element.prototype, "getAnimations", { configurable: true, value: () => [] });
});

test("exposes project, team, release, confirmation, and dynamic collection capabilities", async () => {
  render(<AgentUICapabilityLab />);

  expect((screen.getByRole("textbox", { name: "项目名称" }) as HTMLInputElement).value).toBe("Agent 原生工作台");
  expect(screen.getByRole("progressbar", { name: "发布准备度" })).toBeTruthy();
  const snapshot = testAgent.snapshot();
  expect(snapshot.some((component) => component.component === "tabs")).toBe(true);
  expect(snapshot.some((component) => component.component === "input" && component.label === "项目名称")).toBe(true);
  const changed = await testAgent.act({
    steps: [
      { ref: "项目名称", action: "setValue", args: ["Atlas"] },
      { ref: "首页重点展示", action: "setPressed", args: [false] },
    ],
  });
  expect(changed.ok).toBe(true);
  expect(changed.steps).toHaveLength(2);
  expect((screen.getByRole("textbox", { name: "项目名称" }) as HTMLInputElement).value).toBe("Atlas");
  expect(screen.getByRole("button", { name: /首页重点展示/ }).getAttribute("aria-pressed")).toBe("false");

  fireEvent.click(screen.getByRole("tab", { name: "团队" }));
  expect(screen.getByRole("tab", { name: "团队" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByLabelText("成员 Alice")).toBeTruthy();
  fireEvent.click(screen.getByText("添加 Carol").closest("button")!);
  expect(screen.getByLabelText("成员 Carol")).toBeTruthy();
  expect(screen.getByLabelText("移除 Carol").getAttribute("data-agent-confirm")).toBe("从项目中移除 Carol");

  fireEvent.click(screen.getByRole("tab", { name: "发布" }));
  expect(screen.getByRole("tab", { name: "发布" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByLabelText("生产环境").getAttribute("aria-checked")).toBe("true");
  fireEvent.click(screen.getByText("高级通知设置").closest("button")!);
  expect(screen.getByLabelText("飞书通知").getAttribute("aria-checked")).toBe("true");

  const save = screen.getByRole("button", { name: "保存全部配置" });
  expect(save.getAttribute("data-agent-confirm")).toBe("保存当前项目、团队与发布配置");
  fireEvent.click(save);
  expect(screen.getByText("Revision 1")).toBeTruthy();
  expect(await testAgent.query({ kind: "release-receipt" })).toContainEqual(
    expect.objectContaining({ revision: 1, actions: [] }),
  );
});

test("private values stay out of bridge results and observation context", async () => {
  const bridge = createWorkspaceBridge();
  const cleanup = bridge.mount();
  try {
    render(<AgentUICapabilityLab />);
    bridge.setShareChanges(true);
    const privateField = screen.getByRole("textbox", { name: "私密备注" });
    fireEvent.input(privateField, { target: { value: "internal-note" } });
    fireEvent.blur(privateField);
    expect(privateField).toHaveProperty("value", "internal-note");
    expect(JSON.stringify(bridge.agent.snapshot())).not.toContain("internal-note");
    expect(bridge.prepareContext()?.text ?? "").not.toContain("internal-note");
    const name = screen.getByRole("textbox", { name: "项目名称" });
    fireEvent.input(name, { target: { value: "Atlas" } });
    fireEvent.blur(name);
    const first = bridge.prepareContext();
    expect(first?.text).toContain("Atlas");
    fireEvent.input(name, { target: { value: "Nova" } });
    fireEvent.blur(name);
    first?.acknowledge();
    expect(bridge.prepareContext()?.text).toContain("Nova");
    bridge.prepareContext()?.acknowledge();
    expect(bridge.prepareContext()).toBeUndefined();
  } finally {
    cleanup();
  }
});

test("page Stop cancels a pending confirmation without applying the write or later steps", async () => {
  const bridge = createWorkspaceBridge();
  const cleanup = bridge.mount();
  try {
    render(<AgentUICapabilityLab />);
    const controller = new AbortController();
    const result = bridge.execute(
      "act",
      {
        steps: [
          { ref: "项目名称", action: "setValue", args: ["should not apply"] },
          { ref: "保存全部配置", action: "press" },
        ],
      },
      { signal: controller.signal },
    );
    await waitFor(() => expect(bridge.snapshot().request).toBeTruthy());
    controller.abort();
    expect(await result).toMatchObject({ ok: false });
    expect(bridge.snapshot().request).toBeNull();
    expect(screen.getByRole("textbox", { name: "项目名称" })).toHaveProperty("value", "Agent 原生工作台");
    expect(screen.queryByText("Revision 1")).toBeNull();
  } finally {
    cleanup();
  }
});

test("stopping a closed-panel query dismisses its outstanding navigation permission", async () => {
  const bridge = createWorkspaceBridge();
  const cleanup = bridge.mount();
  try {
    render(<AgentUICapabilityLab />);
    const controller = new AbortController();
    const result = expect(
      bridge.execute("query", { closed: true }, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    await waitFor(() => expect(bridge.snapshot().request).toBeTruthy());
    controller.abort();
    await waitFor(() => expect(bridge.snapshot().request).toBeNull());
    await result;
  } finally {
    cleanup();
  }
});
