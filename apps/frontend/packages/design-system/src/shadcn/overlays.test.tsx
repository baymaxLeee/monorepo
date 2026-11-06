import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";

import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./dialog";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

function Popup({ name, container, zIndex }: { name: string; container?: HTMLElement; zIndex?: number }) {
  return (
    <Popover defaultOpen>
      <PopoverTrigger>{name}触发器</PopoverTrigger>
      <PopoverContent
        data-testid={name}
        container={container}
        positionerStyle={zIndex === undefined ? undefined : { zIndex }}
        initialFocus={false}
      >
        {name}
      </PopoverContent>
    </Popover>
  );
}
test("popup portals follow modal nesting, explicit layers and custom containers", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const view = render(
    <>
      <Popup name="page" />
      <Dialog open>
        <DialogContent initialFocus={false}>
          <DialogTitle>父窗口</DialogTitle>
          <Popup name="parent" />
          <Dialog open>
            <DialogContent initialFocus={false}>
              <DialogTitle>子窗口</DialogTitle>
              <Popup name="child" />
            </DialogContent>
          </Dialog>
        </DialogContent>
      </Dialog>
      <Dialog open>
        <DialogContent style={{ zIndex: 2200 }} initialFocus={false}>
          <DialogTitle>自定义窗口</DialogTitle>
          <Popup name="custom" container={container} />
          <Popup name="escape" zIndex={2400} />
        </DialogContent>
      </Dialog>
    </>,
  );
  await screen.findByTestId("child");
  const layer = (name: string) => screen.getByTestId(name).parentElement!.style.zIndex;
  expect(layer("page")).toBe("");
  expect(layer("parent")).toBe("1050");
  expect(layer("child")).toBe("1150");
  expect(layer("custom")).toBe("2250");
  expect(layer("escape")).toBe("2400");
  expect(container.contains(screen.getByTestId("custom"))).toBe(true);
  expect(
    [...document.querySelectorAll<HTMLElement>('[data-slot="dialog-overlay"]')].map((node) => node.style.zIndex),
  ).toEqual(expect.arrayContaining(["999", "2199"]));
  // Base UI deliberately shares the backdrop for nested dialogs.
  expect(screen.getByText("子窗口").closest<HTMLElement>('[data-slot="dialog-content"]')?.style.zIndex).toBe("1100");
  view.unmount();
  container.remove();
});

test("Escape closes the popup first and returns focus before closing its dialog", async () => {
  render(
    <Dialog>
      <DialogTrigger>打开窗口</DialogTrigger>
      <DialogContent>
        <DialogTitle>窗口</DialogTitle>
        <Popover>
          <PopoverTrigger>打开浮层</PopoverTrigger>
          <PopoverContent>
            <button>浮层操作</button>
          </PopoverContent>
        </Popover>
      </DialogContent>
    </Dialog>,
  );
  fireEvent.click(screen.getByRole("button", { name: "打开窗口" }));
  fireEvent.click(await screen.findByRole("button", { name: "打开浮层" }));
  const action = await screen.findByRole("button", { name: "浮层操作" });
  fireEvent.keyDown(action, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("button", { name: "浮层操作" })).toBeNull());
  expect(screen.getByRole("dialog", { name: "窗口" })).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "打开浮层" })));
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "窗口" })).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "打开窗口" })));
});
