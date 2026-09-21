import { Menu as NativeMenu, MenuItem, Separator } from "@repo/design-system";
import { Children, cloneElement, isValidElement, type ComponentProps, type ReactNode } from "react";

function Item(props: ComponentProps<typeof MenuItem>) {
  return <MenuItem {...props} />;
}
function MenuRoot({
  children,
  onClickMenuItem,
  selectedKeys,
  className,
  style,
}: {
  children?: ReactNode;
  onClickMenuItem?: (key: string) => void;
  selectedKeys?: string[];
  className?: string;
  style?: ComponentProps<typeof NativeMenu>["style"];
}) {
  return (
    <NativeMenu
      inline
      className={className}
      style={style}
      onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const items = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)'),
        ];
        if (!items.length) return;
        event.preventDefault();
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}
    >
      {Children.map(children, (child) => {
        if (!isValidElement<ComponentProps<typeof MenuItem>>(child) || child.type !== Item) return child;
        const key = String(child.key ?? "");
        return cloneElement(child, {
          active: selectedKeys?.includes(key),
          onClick: (event) => {
            child.props.onClick?.(event);
            onClickMenuItem?.(key);
          },
        });
      })}
    </NativeMenu>
  );
}
export const Menu = Object.assign(MenuRoot, { Item, Divider: Separator });
