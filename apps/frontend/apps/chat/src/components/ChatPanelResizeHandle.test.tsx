import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ChatPanelResizeHandle } from "./ChatPanelResizeHandle";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "PointerEvent",
    class extends MouseEvent {
      readonly pointerId: number;
      constructor(type: string, options: PointerEventInit = {}) {
        super(type, options);
        this.pointerId = options.pointerId ?? 1;
      }
    },
  );
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, "setPointerCapture");
  Reflect.deleteProperty(HTMLElement.prototype, "hasPointerCapture");
});

function setup(edge: "left-panel" | "right-panel" = "left-panel") {
  const updates = vi.fn();
  const saved = vi.fn();
  function Panel({ disabled = false }: { disabled?: boolean }) {
    const [width, setWidth] = useState(300);
    const widthRef = useRef(width);
    return (
      <ChatPanelResizeHandle
        edge={edge}
        value={width}
        disabled={disabled}
        onDragStart={() => {}}
        onDrag={(delta) => {
          widthRef.current += edge === "left-panel" ? delta : -delta;
          setWidth(widthRef.current);
          updates(widthRef.current);
        }}
        onDragEnd={() => saved(widthRef.current)}
      />
    );
  }
  const view = render(<Panel />);
  const handle = screen.getByRole("separator");
  fireEvent.pointerDown(handle, { button: 0, clientX: 100 });
  return { ...view, handle, updates, saved, disable: () => view.rerender(<Panel disabled />) };
}

it.each(["left-panel", "right-panel"] as const)("coalesces %s movement into one width update per frame", (edge) => {
  const { handle, updates } = setup(edge);
  fireEvent.pointerMove(window, { clientX: 110 });
  fireEvent.pointerMove(window, { clientX: 125 });
  fireEvent.pointerMove(window, { clientX: 120 });
  expect(updates).not.toHaveBeenCalled();
  act(() => vi.advanceTimersToNextFrame());
  expect(updates).toHaveBeenCalledTimes(1);
  expect(handle.getAttribute("aria-valuenow")).toBe(edge === "left-panel" ? "320" : "280");
  fireEvent.pointerMove(window, { clientX: 130 });
  act(() => vi.advanceTimersToNextFrame());
  expect(updates).toHaveBeenCalledTimes(2);
  expect(handle.getAttribute("aria-valuenow")).toBe(edge === "left-panel" ? "330" : "270");
  fireEvent.pointerUp(window, { clientX: 130 });
});

it("flushes the final movement before saving when released before the next frame", () => {
  const { handle, updates, saved } = setup();
  fireEvent.pointerMove(window, { clientX: 125 });
  fireEvent.pointerUp(window, { clientX: 125 });
  expect(handle.getAttribute("aria-valuenow")).toBe("325");
  expect(saved).toHaveBeenCalledExactlyOnceWith(325);
  act(() => vi.advanceTimersToNextFrame());
  expect(updates).toHaveBeenCalledTimes(1);
  expect(document.body.style.cursor).toBe("");
  expect(document.body.style.userSelect).toBe("");
});

it.each(["pointercancel", "blur", "lostpointercapture"])("finishes dragging on %s", (event) => {
  const { handle, updates, saved } = setup();
  fireEvent.pointerMove(window, { clientX: 120 });
  fireEvent(event === "lostpointercapture" ? handle : window, new PointerEvent(event));
  expect(saved).toHaveBeenCalledExactlyOnceWith(320);
  updates.mockClear();
  fireEvent.pointerMove(window, { clientX: 160 });
  act(() => vi.advanceTimersToNextFrame());
  expect(updates).not.toHaveBeenCalled();
  expect(document.body.style.cursor).toBe("");
});

it.each(["unmount", "disable"] as const)("cancels pending work and listeners on %s", (action) => {
  const view = setup();
  fireEvent.pointerMove(window, { clientX: 120 });
  view.updates.mockClear();
  view[action]();
  fireEvent.pointerMove(window, { clientX: 160 });
  act(() => vi.advanceTimersToNextFrame());
  expect(view.updates).not.toHaveBeenCalled();
  expect(document.body.style.cursor).toBe("");
  expect(document.body.style.userSelect).toBe("");
});

it("keeps keyboard resizing immediate", () => {
  const { handle, saved } = setup();
  fireEvent.pointerUp(window, { clientX: 100 });
  saved.mockClear();
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  expect(handle.getAttribute("aria-valuenow")).toBe("316");
  expect(saved).toHaveBeenCalledExactlyOnceWith(316);
});

it("ignores a second pointer during the active drag", () => {
  const { handle, saved } = setup();
  fireEvent.pointerDown(handle, { pointerId: 2, button: 0, clientX: 200 });
  fireEvent.pointerMove(window, { pointerId: 2, clientX: 250 });
  fireEvent.pointerUp(window, { pointerId: 2, clientX: 250 });
  expect(saved).not.toHaveBeenCalled();
  fireEvent.pointerMove(window, { clientX: 120 });
  fireEvent.pointerUp(window, { clientX: 120 });
  expect(handle.getAttribute("aria-valuenow")).toBe("320");
  expect(saved).toHaveBeenCalledExactlyOnceWith(320);
});

it("reports the clamped live width when resizing does not render the parent", () => {
  render(
    <ChatPanelResizeHandle
      edge="right-panel"
      value={400}
      onDragStart={() => {}}
      onDrag={() => 425}
      onDragEnd={() => {}}
    />,
  );
  const handle = screen.getByRole("separator");
  fireEvent.pointerDown(handle, { button: 0, clientX: 100 });
  fireEvent.pointerMove(window, { clientX: 50 });
  act(() => vi.advanceTimersToNextFrame());
  expect(handle.getAttribute("aria-valuenow")).toBe("425");
  fireEvent.pointerUp(window, { clientX: 50 });
});
