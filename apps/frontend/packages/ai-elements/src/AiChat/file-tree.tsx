import { Button } from "@repo/design-system/shadcn/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@repo/design-system/shadcn/collapsible";
import { cn } from "@repo/shared";
import { ChevronRightIcon, FileIcon, FolderIcon } from "lucide-react";
import { createContext, useContext, useState, type ComponentProps, type ReactNode } from "react";

type FileTreeState = { selected?: string; select: (path: string) => void };
const FileTreeContext = createContext<FileTreeState>({ select: () => {} });
export type FileTreeProps = Omit<ComponentProps<"div">, "onSelect"> & {
  selectedPath?: string;
  onSelect?: (path: string) => void;
};
export function FileTree({ selectedPath, onSelect, className, ...props }: FileTreeProps) {
  const [selected, setSelected] = useState<string>();
  return (
    <FileTreeContext
      value={{
        selected: selectedPath ?? selected,
        select: (path) => {
          setSelected(path);
          onSelect?.(path);
        },
      }}
    >
      <div className={cn("min-w-0 text-sm", className)} {...props} />
    </FileTreeContext>
  );
}
export type FileTreeFolderProps = ComponentProps<typeof Collapsible> & { name: string };
export function FileTreeFolder({ name, children, ...props }: FileTreeFolderProps) {
  return (
    <Collapsible {...props}>
      <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="group/folder w-full justify-start" />}>
        <ChevronRightIcon className="size-3 group-aria-expanded/folder:rotate-90" />
        <FolderIcon />
        <span className="truncate">{name}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="ml-4 border-l pl-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}
export type FileTreeFileProps = Omit<ComponentProps<typeof Button>, "onSelect"> & {
  path: string;
  name?: string;
  actions?: ReactNode;
};
export function FileTreeFile({ path, name, actions, children, className, onClick, ...props }: FileTreeFileProps) {
  const tree = useContext(FileTreeContext);
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        className={cn("min-w-0 flex-1 justify-start", className)}
        aria-pressed={tree.selected === path}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) tree.select(path);
        }}
        {...props}
      >
        <FileIcon />
        {children ?? <span className="truncate">{name ?? path.split("/").at(-1)}</span>}
      </Button>
      {actions}
    </div>
  );
}
export function FileTreeActions(props: ComponentProps<"div">) {
  return <div className="flex shrink-0 items-center gap-1" {...props} />;
}
