import { Button } from "@repo/design-system/shadcn/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@repo/design-system/shadcn/command";
import { InputGroupAddon } from "@repo/design-system/shadcn/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/design-system/shadcn/popover";
import { ChevronDownIcon, FolderIcon, FolderPlusIcon } from "lucide-react";
import { useState } from "react";

import { composerControlClassName } from "../../composer-control-styles";
import { ExecutionLocation } from "./ExecutionLocation";

export function NewConversationEnvironment({
  location,
  onLocationChange,
  projects,
  project,
  onProjectChange,
  onCreateProject,
  disabled,
  selectingProject,
}: {
  location: "cloud" | "local";
  onLocationChange: (location: "cloud" | "local") => void;
  projects: string[];
  project: string | null;
  onProjectChange: (project: string) => void;
  onCreateProject: () => void;
  disabled?: boolean;
  selectingProject?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const label = project ? project.split(/[\\/]/).filter(Boolean).at(-1) || project : "选择项目";

  return (
    <InputGroupAddon align="block-start" className="justify-start gap-1 py-1 pr-3">
      <ExecutionLocation
        value={location}
        onChange={onLocationChange}
        localAvailable
        disabled={disabled}
        localLabel="此计算机"
      />
      {location === "local" ? (
        <>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={`h-7 min-w-0 max-w-64 justify-start gap-1.5 rounded-md px-2 text-xs font-normal ${composerControlClassName}`}
                  aria-label="选择项目"
                  disabled={disabled || selectingProject}
                />
              }
            >
              <FolderIcon className="size-4 shrink-0" />
              <span className="truncate">{selectingProject ? "正在选择…" : label}</span>
              <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
            </PopoverTrigger>
            <PopoverContent align="start" side="bottom" className="w-80 p-0">
              <Command>
                <CommandInput placeholder="搜索项目" />
                <CommandList>
                  <CommandEmpty>没有匹配的项目</CommandEmpty>
                  {projects.length > 0 ? (
                    <CommandGroup heading="项目">
                      {projects.map((item) => (
                        <CommandItem
                          key={item}
                          value={item}
                          data-checked={item === project}
                          onSelect={() => {
                            onProjectChange(item);
                            setOpen(false);
                          }}
                        >
                          <FolderIcon />
                          <span className="min-w-0 flex-1 truncate">{item}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ) : null}
                  <CommandSeparator />
                  <CommandGroup>
                    <CommandItem
                      value="新建项目"
                      onSelect={() => {
                        setOpen(false);
                        onCreateProject();
                      }}
                    >
                      <FolderPlusIcon />
                      新建项目
                    </CommandItem>
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </>
      ) : null}
    </InputGroupAddon>
  );
}
