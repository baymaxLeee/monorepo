import type { DesktopBridge } from "@repo/runtime/desktop";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { LocalFiles } from "./LocalFiles";

it("uses the local bridge only as the browser data source and delegates file opening", async () => {
  const onOpen = vi.fn();
  const bridge = {
    listFiles: vi.fn(async () => [{ name: "demo.js", directory: false, symlink: false }]),
    subscribe: () => () => {},
  } as unknown as DesktopBridge;

  render(<LocalFiles bridge={bridge} id="thread" onOpen={onOpen} />);
  fireEvent.click(await screen.findByRole("button", { name: "demo.js" }));

  expect(bridge.listFiles).toHaveBeenCalledWith("thread", ".");
  expect(onOpen).toHaveBeenCalledWith("demo.js");
});
