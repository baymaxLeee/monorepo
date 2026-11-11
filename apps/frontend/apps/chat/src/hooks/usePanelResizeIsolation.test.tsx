import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { usePanelResizeIsolation } from "./usePanelResizeIsolation";

function IsolationHarness() {
  const { groupRef, startResize } = usePanelResizeIsolation();
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;

  return (
    <div ref={groupRef} data-testid="group" onPointerDownCapture={startResize}>
      <div data-panel className="relative">
        <div data-testid="start-content" data-chat-panel-resize-isolate="start">
          conversation
        </div>
      </div>
      <div data-slot="resizable-handle" data-testid="handle" />
      <div data-panel className="relative">
        <div data-testid="end-content" data-chat-panel-resize-isolate="end">
          preview
        </div>
      </div>
      <output data-testid="render-count">{renderCountRef.current}</output>
    </div>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

it("freezes isolated content during pointer resizing and restores it on release", () => {
  const measure = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      const width = this.dataset.testid === "end-content" ? 480 : 720;
      return { width, height: 640, top: 0, right: width, bottom: 640, left: 0, x: 0, y: 0, toJSON: vi.fn() };
    });
  render(<IsolationHarness />);

  fireEvent.pointerDown(screen.getByTestId("handle"), { button: 0, pointerId: 7 });

  const group = screen.getByTestId("group");
  const start = screen.getByTestId("start-content");
  const end = screen.getByTestId("end-content");
  expect(group.dataset.panelResizeActive).toBe("true");
  expect(start.style.cssText).toContain("width: 720px");
  expect(start.style.insetInlineStart).toBe("0px");
  expect(end.style.cssText).toContain("width: 480px");
  expect(end.style.insetInlineEnd).toBe("0px");
  expect(start.style.contain).toBe("strict");
  expect(screen.getByTestId("render-count").textContent).toBe("1");

  fireEvent.pointerMove(screen.getByTestId("handle"), { buttons: 1, pointerId: 7 });
  expect(measure).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId("render-count").textContent).toBe("1");

  fireEvent.pointerUp(document, { pointerId: 7 });

  expect(group.dataset.panelResizeActive).toBeUndefined();
  expect(start.style.cssText).toBe("");
  expect(end.style.cssText).toBe("");
  expect(screen.getByTestId("render-count").textContent).toBe("1");
});

it("does not freeze content for pointer interaction outside a resize handle", () => {
  const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
  render(<IsolationHarness />);

  fireEvent.pointerDown(screen.getByTestId("start-content"), { button: 0, pointerId: 3 });

  expect(screen.getByTestId("group").dataset.panelResizeActive).toBeUndefined();
  expect(measure).not.toHaveBeenCalled();
});

it("restores frozen content when the pointer sequence is cancelled", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 640,
    height: 480,
    top: 0,
    right: 640,
    bottom: 480,
    left: 0,
    x: 0,
    y: 0,
    toJSON: vi.fn(),
  });
  render(<IsolationHarness />);

  fireEvent.pointerDown(screen.getByTestId("handle"), { button: 0, pointerId: 11 });
  fireEvent.pointerCancel(document, { pointerId: 11 });

  expect(screen.getByTestId("group").dataset.panelResizeActive).toBeUndefined();
  expect(screen.getByTestId("start-content").style.cssText).toBe("");
  expect(screen.getByTestId("end-content").style.cssText).toBe("");
});
