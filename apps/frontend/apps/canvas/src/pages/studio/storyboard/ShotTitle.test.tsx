import { act, render } from "@testing-library/react";
import { createAgent } from "@ui-sdk/react/agent";
import { useState } from "react";
import { expect, test, vi } from "vitest";

import { ShotTitle } from "./ShotTitle";

test("the storyboard primitive requests confirmation, uses the selected shot and observes the saved title", async () => {
  let approve = false;
  const allow = vi.fn(() => approve);
  const agent = createAgent({ allow });
  const persist = vi.fn(async (_id: string, title: string) => title);
  function Shot() {
    const [name, setName] = useState("Opening");
    return (
      <ShotTitle
        index={0}
        shotId="shot-1"
        name={name}
        onRename={async (id, name) => {
          const saved = await persist(id, name);
          setName(saved);
          return saved;
        }}
      />
    );
  }
  render(<Shot />);
  const args = { steps: [{ ref: "当前分镜名称", action: "rename", args: ["New title"] }] };
  expect((await agent.act(args)).ok).toBe(false);
  expect(persist).not.toHaveBeenCalled();
  approve = true;
  await act(async () => {
    expect((await agent.act(args)).ok).toBe(true);
  });
  expect(persist).toHaveBeenCalledExactlyOnceWith("shot-1", "New title");
  expect(allow.mock.lastCall).toEqual(
    expect.arrayContaining([expect.objectContaining({ confirm: "保存当前分镜的新名称", args: ["New title"] })]),
  );
  expect(agent.snapshot()).toEqual(
    expect.arrayContaining([expect.objectContaining({ component: "storyboard-shot", value: "New title" })]),
  );
});
