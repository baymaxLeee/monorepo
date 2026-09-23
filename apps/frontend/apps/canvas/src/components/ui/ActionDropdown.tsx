import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@repo/design-system";
import { type ReactElement, type ReactNode } from "react";

type DropdownPosition = "top" | "bottom" | "left" | "right" | "tl" | "tr" | "bl" | "br";

export interface ActionDropdownItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  destructive?: boolean;
}

export interface ActionDropdownProps {
  children: ReactElement;
  items: readonly ActionDropdownItem[];
  onSelect: (key: string) => void;
  position?: DropdownPosition;
  disabled?: boolean;
}

function placement(position: DropdownPosition = "bottom") {
  const side = ({ t: "top", b: "bottom", l: "left", r: "right" } as const)[position[0] as "t" | "b" | "l" | "r"];
  const align = position.length === 2 ? ("lt".includes(position[1]) ? "start" : "end") : "center";
  return { side, align } as const;
}

/** A compact action list with menu semantics, keyboard navigation, and modal-aware portal layering. */
export function ActionDropdown({ children, items, onSelect, position, disabled }: ActionDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger disabled={disabled} render={children} />
      <DropdownMenuContent
        {...placement(position)}
        className="canvas-web-theme w-max p-1.5"
        style={{ minWidth: "max(var(--anchor-width), 8rem)" }}
      >
        {items.map((item) => (
          <DropdownMenuItem
            className="h-9 gap-2 whitespace-nowrap rounded-md px-2.5 py-0"
            disabled={item.disabled}
            key={item.key}
            onClick={() => onSelect(item.key)}
            variant={item.destructive ? "destructive" : "default"}
          >
            {item.icon}
            <span>{item.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
