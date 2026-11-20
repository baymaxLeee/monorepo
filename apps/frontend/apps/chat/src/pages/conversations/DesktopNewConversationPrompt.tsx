import { PromptInput, type PromptInputProps } from "@repo/ai-elements/prompt-input";
import {
  Button,
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/design-system";
import { cn } from "@repo/shared";
import { CloudIcon, FolderIcon, MonitorIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

export function DesktopNewConversationPrompt({
  location,
  onLocationChange,
  localAvailable = true,
  projects,
  project,
  onProjectChange,
  onCreateProject,
  selectingProject,
  contextDisabled,
  className,
  ...promptProps
}: PromptInputProps & {
  location: "cloud" | "local";
  onLocationChange: (value: "cloud" | "local") => void;
  localAvailable?: boolean;
  projects: string[];
  project: string | null;
  onProjectChange: (project: string) => void;
  onCreateProject: () => void;
  selectingProject?: boolean;
  contextDisabled?: boolean;
}) {
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const projectLabel = project ? project.split(/[\\/]/).filter(Boolean).at(-1) || project : "选择项目";
  const LocationIcon = location === "local" ? MonitorIcon : CloudIcon;

  return (
    <footer className="relative z-10 mx-auto w-full max-w-3xl shrink-0 bg-gradient-to-t from-background from-70% to-transparent px-4 pt-4 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div className="relative">
        <div
          data-testid="desktop-new-conversation-context"
          className="mx-4 h-14 rounded-t-[1.25rem] bg-muted/70 px-4 ring-1 ring-foreground/5"
        >
          <div className="flex h-10 min-w-0 items-center gap-1 text-xs">
            <Select
              value={location}
              onValueChange={(next) => {
                if (next === "cloud" || next === "local") onLocationChange(next);
              }}
              disabled={promptProps.disabled || contextDisabled}
            >
              <SelectTrigger
                aria-label="执行位置"
                size="sm"
                className="h-8 gap-2 rounded-full border-0 bg-transparent px-2 text-xs shadow-none hover:bg-foreground/10 aria-expanded:bg-foreground/10 data-[size=sm]:rounded-full focus-visible:border-transparent focus-visible:ring-1 focus-visible:ring-ring/40 [&>svg:last-child]:hidden"
              >
                <LocationIcon className="size-3.5" />
                <SelectValue>{location === "local" ? "此计算机" : "云端"}</SelectValue>
              </SelectTrigger>
              <SelectContent side="top" align="start">
                <SelectItem value="local" disabled={!localAvailable}>
                  {localAvailable ? "此计算机" : "此计算机（不可用）"}
                </SelectItem>
                <SelectItem value="cloud">云端</SelectItem>
              </SelectContent>
            </Select>

            {location === "local" ? (
              <Combobox
                value={project}
                open={projectPickerOpen}
                onOpenChange={setProjectPickerOpen}
                onValueChange={(next) => {
                  if (typeof next !== "string" || !next) return;
                  onProjectChange(next);
                  setProjectPickerOpen(false);
                }}
                disabled={promptProps.disabled || contextDisabled || selectingProject}
              >
                <ComboboxTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 min-w-0 max-w-72 justify-start gap-2 rounded-full px-2 text-xs font-normal hover:bg-foreground/10 aria-expanded:bg-foreground/10 [&>svg:last-child]:hidden"
                      aria-label="选择项目"
                      disabled={promptProps.disabled || contextDisabled || selectingProject}
                    />
                  }
                >
                  <FolderIcon className="size-3.5 shrink-0" />
                  <span className="truncate">{selectingProject ? "正在选择…" : projectLabel}</span>
                </ComboboxTrigger>
                <ComboboxContent
                  align="start"
                  side="top"
                  className="w-64 *:data-[slot=input-group]:rounded-none! *:data-[slot=input-group]:border-x-0! *:data-[slot=input-group]:border-t-0! *:data-[slot=input-group]:bg-transparent!"
                >
                  <ComboboxInput placeholder="搜索项目" showTrigger={false} />
                  <ComboboxList className="max-h-52">
                    <ComboboxEmpty>没有匹配的项目</ComboboxEmpty>
                    {projects.map((item) => {
                      const label = item.split(/[\\/]/).filter(Boolean).at(-1) || item;
                      return (
                        <ComboboxItem key={item} value={item} className="rounded-lg px-2.5 py-2 data-selected:bg-muted">
                          <FolderIcon />
                          <span className="min-w-0 flex-1 truncate">{label}</span>
                        </ComboboxItem>
                      );
                    })}
                  </ComboboxList>
                  <div className="border-t p-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start gap-2 rounded-lg px-2.5 font-normal"
                      onClick={() => {
                        setProjectPickerOpen(false);
                        onCreateProject();
                      }}
                    >
                      <PlusIcon />
                      新建项目
                    </Button>
                  </div>
                </ComboboxContent>
              </Combobox>
            ) : null}
          </div>
        </div>

        <div data-testid="desktop-new-conversation-editor" className="relative z-10 -mt-4">
          <PromptInput
            {...promptProps}
            className={cn(
              "desktop-new-conversation-prompt",
              "[&_[data-slot=input-group]]:min-h-24! [&_[data-slot=input-group]]:rounded-2xl! [&_[data-slot=input-group]]:border-foreground/10 [&_[data-slot=input-group]]:bg-background! [&_[data-slot=input-group]]:shadow-[0_18px_45px_-28px_rgb(0_0_0/0.35)]",
              "[&_.prompt-input-content]:px-5 [&_.prompt-input-content]:pt-4 [&_.prompt-input-prosemirror]:min-h-10 [&_.prompt-input-prosemirror]:text-base",
              "[&_.prompt-input-footer]:mt-auto [&_.prompt-input-footer]:px-4 [&_.prompt-input-footer]:pt-1 [&_.prompt-input-footer]:pb-1 [&_.prompt-input-tools]:flex-1",
              className,
            )}
          />
        </div>
      </div>
    </footer>
  );
}
