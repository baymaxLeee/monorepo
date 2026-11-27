import type { MCPAppBridgeHandlers, MCPAppRendererProps } from "@ai-sdk/react";
import type { PromptInputRef } from "@repo/ai-elements/prompt-input";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { createMCPAppContext, MCPAppContext } from "../lib/mcp-app-context";
import { MCPAppComposer, MCPAppView, readMCPAppView } from "./MCPAppView";

let handlers: MCPAppBridgeHandlers;
vi.mock("@ai-sdk/react", () => ({
  MCPAppRenderer: (props: MCPAppRendererProps) => {
    handlers = props.handlers!;
    return <div>result view</div>;
  },
}));
afterEach(cleanup);

const resource = { uri: "ui://knowledge/search", mimeType: "text/html;profile=mcp-app", html: "<main>results</main>" };
const part: MCPAppRendererProps["part"] = {
  type: "dynamic-tool",
  toolName: "search",
  toolCallId: "call",
  state: "output-available",
  input: {},
  toolMetadata: { agent: { source: "mcp" } },
  output: { ok: true, status: "completed", data: { content: [], _meta: { mcpAppResource: resource } } },
};
test("only completed MCP calls can render and the host serves only the captured resource", async () => {
  expect(readMCPAppView({ ...part, toolMetadata: {} })).toBeNull();
  expect(readMCPAppView({ ...part, preliminary: true })).toBeNull();
  const view = readMCPAppView(part)!;
  expect(JSON.stringify(view.part.output)).not.toContain("<main>");
  render(<MCPAppView view={view} />);
  expect(await handlers.readResource!({ uri: resource.uri })).toMatchObject({ contents: [{ text: resource.html }] });
  expect(() => handlers.readResource!({ uri: "ui://other" })).toThrow();
});
test("a follow-up enters the existing composer only after review and preserves its draft", async () => {
  const input = {
    getValue: () => ({ text: "existing", segments: [{ type: "text", text: "existing" }], tokens: [], files: {} }),
    setValue: vi.fn(),
    focus: vi.fn(),
  };
  const { unmount } = render(
    <MCPAppComposer.Provider value={{ current: input as unknown as PromptInputRef }}>
      <MCPAppView view={readMCPAppView(part)!} />
    </MCPAppComposer.Provider>,
  );
  const request = { role: "user", content: [{ type: "text", text: "explain this" }] };
  let response: unknown;
  act(() => {
    response = handlers.sendMessage!(request);
  });
  expect(input.setValue).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "加入输入框" }));
  expect(await response).toEqual({ isError: false });
  expect(input.setValue).toHaveBeenCalledWith(expect.objectContaining({ text: "existing\nexplain this" }));
  act(() => {
    response = handlers.sendMessage!(request);
  });
  unmount();
  expect(await response).toEqual({ isError: true });
});

test("only the latest approved app context accompanies a new message and failed sends keep it", async () => {
  const context = createMCPAppContext();
  render(
    <MCPAppContext.Provider value={context}>
      <MCPAppView view={readMCPAppView(part)!} />
    </MCPAppContext.Provider>,
  );
  let response: unknown;
  act(() => {
    response = handlers.updateModelContext!({ structuredContent: { selected: "first" } });
  });
  expect(context.prepare()).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "同意共享" }));
  await response;
  const queued = context.prepare()!;
  expect(queued.text).toContain("first");
  act(() => {
    response = handlers.updateModelContext!({ content: [{ type: "text", text: "second" }] });
  });
  fireEvent.click(screen.getByRole("button", { name: "同意共享" }));
  await response;
  queued.acknowledge();
  const next = context.prepare()!;
  expect(next.text).toContain("second");
  next.acknowledge();
  expect(context.prepare()).toBeUndefined();
});
