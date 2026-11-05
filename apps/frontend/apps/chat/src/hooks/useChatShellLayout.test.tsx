import { act, render, screen } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { type ChatShellLayout, useChatShellLayout } from "./useChatShellLayout";

let onResize: ResizeObserverCallback;
let containerWidth = 1000;

beforeEach(() => {
  localStorage.clear();
  containerWidth = 1000;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 0, containerWidth, 800),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        onResize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => vi.unstubAllGlobals());

function setup(open = true) {
  let shell: ChatShellLayout;
  const renders = vi.fn();
  const close = vi.fn();
  function Shell({ artifactOpen = open, unrelated = 0 }) {
    const layout = useChatShellLayout(artifactOpen, close);
    renders();
    useLayoutEffect(() => {
      shell = layout;
    });
    return (
      <div ref={layout.containerRef} data-testid="shell">
        <aside ref={layout.leftPanelRef} data-testid="left-panel" />
        <span>{unrelated}</span>
        <div ref={layout.rightPanelRef} data-testid="right-panel" />
      </div>
    );
  }
  const view = render(<Shell />);
  return { ...view, current: () => shell!, renders, close, Shell, element: screen.getByTestId("shell") };
}

it.each(["left-panel", "right-panel"] as const)("resizes %s without rendering the shell on every frame", (edge) => {
  const view = setup();
  act(() => view.current().startResize(edge));
  view.renders.mockClear();
  for (let i = 0; i < 5; i++) {
    act(() => {
      if (edge === "left-panel") view.current().resizeLeft(5);
      else view.current().resizeRight(-5);
    });
  }
  expect(view.renders).not.toHaveBeenCalled();
  expect(view.element.style.gridTemplateColumns).toBe(
    edge === "left-panel" ? "175px minmax(0, 1fr) 400px" : "150px minmax(0, 1fr) 425px",
  );
  // Updates elsewhere in the shell must not overwrite the live drag width.
  view.rerender(<view.Shell unrelated={1} />);
  expect(view.element.style.gridTemplateColumns).toContain(edge === "left-panel" ? "175px" : "425px");
  act(() => view.current().endResize(edge));
  expect(view.current().isDragging).toBe(false);
  expect(localStorage.getItem(edge === "left-panel" ? "chat:left-width" : "chat:right-width")).toBe(
    edge === "left-panel" ? "175" : "425",
  );
  expect(edge === "left-panel" ? view.current().leftWidth : view.current().rightWidth).toBe(
    edge === "left-panel" ? 175 : 425,
  );
});

it("keeps the main area minimum width and clamps the panel width", () => {
  const view = setup();
  act(() => view.current().startResize("right-panel"));
  act(() => view.current().resizeRight(-1000));
  expect(view.element.style.gridTemplateColumns).toBe("150px minmax(0, 1fr) 530px");
  act(() => view.current().endResize("right-panel"));
  expect(view.current().rightWidth).toBe(530);
});

it("collapses only on release and restores the preferred width on reopening", () => {
  const view = setup();
  act(() => view.current().startResize("left-panel"));
  act(() => view.current().resizeLeft(-100));
  expect(view.current().leftOpen).toBe(true);
  expect(view.element.style.gridTemplateColumns).toBe("50px minmax(0, 1fr) 400px");
  act(() => view.current().endResize("left-panel"));
  expect(view.current().leftOpen).toBe(false);
  expect(view.element.style.gridTemplateColumns).toBe("0px minmax(0, 1fr) 400px");
  act(() => view.current().toggleLeft());
  expect(view.current().leftWidth).toBe(150);
});

it("reclamps live widths after the container shrinks", () => {
  const view = setup();
  act(() => view.current().startResize("right-panel"));
  act(() => view.current().resizeRight(-100));
  act(() => {
    containerWidth = 800;
    onResize([{ contentRect: new DOMRect(0, 0, 800, 800) } as ResizeObserverEntry], {} as ResizeObserver);
  });
  act(() => view.current().endResize("right-panel"));
  expect(view.current().leftWidth + view.current().rightWidth).toBeLessThanOrEqual(480);
});

it("updates compact overlays without shrinking the conversation column", () => {
  containerWidth = 375;
  const view = setup();
  expect(view.current().compact).toBe(true);
  act(() => view.current().startResize("right-panel"));
  act(() => view.current().resizeRight(20));
  expect(view.element.style.gridTemplateColumns).toBe("0px minmax(0, 1fr) 0px");
  expect(screen.getByTestId("right-panel").style.width).toBe("min(37.5px, 100% - 3rem)");
  act(() => view.current().endResize("right-panel"));
  expect(view.current().rightWidth).toBe(37.5);
});

it("opens and closes the workspace without losing the saved width", () => {
  const view = setup(false);
  expect(view.element.style.gridTemplateColumns).toBe("150px minmax(0, 1fr) 0px");
  view.rerender(<view.Shell artifactOpen />);
  expect(view.element.style.gridTemplateColumns).toBe("150px minmax(0, 1fr) 400px");
  act(() => view.current().startResize("right-panel"));
  act(() => view.current().resizeRight(-40));
  act(() => view.current().endResize("right-panel"));
  view.rerender(<view.Shell artifactOpen={false} />);
  view.rerender(<view.Shell artifactOpen />);
  expect(view.element.style.gridTemplateColumns).toBe("150px minmax(0, 1fr) 440px");
});
