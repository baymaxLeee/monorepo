import { ChevronDown } from "lucide-react";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";

interface ItemProps {
  children?: ReactNode;
  extra?: ReactNode;
  header?: ReactNode;
  name: string;
}

function Item({ children }: ItemProps) {
  return <>{children}</>;
}

function CollapseRoot({
  activeKey = [],
  children,
  className,
  expandIcon,
  onChange,
}: {
  activeKey?: string[];
  bordered?: boolean;
  children?: ReactNode;
  className?: string;
  expandIcon?: ReactNode;
  lazyload?: boolean;
  onChange?: (key: string, activeKeys: string[]) => void;
}) {
  return (
    <div className={className}>
      {Children.map(children, (child) => {
        if (!isValidElement<ItemProps>(child)) return child;
        const { children: content, extra, header, name } = child.props;
        const open = activeKey.includes(name);
        return (
          <section data-collapse-item data-state={open ? "open" : "closed"} key={name}>
            <div className="flex items-center gap-2" data-collapse-header>
              <button
                aria-expanded={open}
                className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left"
                data-collapse-trigger
                onClick={() => onChange?.(name, open ? activeKey.filter((key) => key !== name) : [...activeKey, name])}
                type="button"
              >
                <span className={`transition-transform ${open ? "rotate-180" : ""}`} data-collapse-icon>
                  {expandIcon ?? <ChevronDown className="size-4" />}
                </span>
                <span className="min-w-0 flex-1" data-collapse-title>
                  {header}
                </span>
              </button>
              <span data-collapse-extra>{extra}</span>
            </div>
            {open ? <div data-collapse-content>{content}</div> : null}
          </section>
        );
      })}
    </div>
  );
}

export const Collapse = Object.assign(CollapseRoot, { Item: Item as (props: ItemProps) => ReactElement });
