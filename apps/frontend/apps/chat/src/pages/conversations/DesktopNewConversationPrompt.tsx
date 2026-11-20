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
  InputGroupAddon,
} from "@repo/design-system";
import { cn } from "@repo/shared";
import { CloudIcon, FolderIcon, LaptopIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useState } from "react";

const contextButtonClass =
  "h-7 min-w-0 max-w-72 gap-1.5 rounded-full px-2.5 text-sm font-normal hover:bg-foreground/10 aria-expanded:bg-foreground/10 [&>svg:last-child]:hidden";

const popupClass = "flex w-[16.25rem] min-w-0 flex-col rounded-2xl p-1 shadow-lg";
const itemClass = "min-h-7 gap-2 rounded-xl pl-2.5";
const locations = ["local", "cloud"] as const;

function ContextSearch({ placeholder }: { placeholder: string }) {
  return (
    <div className="mx-2 mb-1 border-b border-border/75 focus-within:border-muted-foreground/40">
      <ComboboxInput
        aria-label={placeholder}
        placeholder={placeholder}
        showTrigger={false}
        className="h-8 rounded-none border-0 bg-transparent shadow-none ring-0! dark:bg-transparent [&_input]:text-[13px] [&_input]:placeholder:text-muted-foreground/80"
      >
        <InputGroupAddon className="pl-0.5 text-muted-foreground/80">
          <SearchIcon className="size-3" strokeWidth={1.5} />
        </InputGroupAddon>
      </ComboboxInput>
    </div>
  );
}

function projectName(project: string) {
  return project.split(/[\\/]/).filter(Boolean).at(-1) || project;
}

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
  const [projectOpen, setProjectOpen] = useState(false);
  const locationLabel = (value: "local" | "cloud") =>
    value === "cloud" ? "云端" : localAvailable ? "此计算机" : "此计算机（不可用）";
  const projectLabel = project ? projectName(project) : "选择项目";
  const LocationIcon = location === "local" ? LaptopIcon : CloudIcon;

  return (
    <footer className="relative z-10 mx-auto w-full max-w-3xl shrink-0 bg-gradient-to-t from-background from-70% to-transparent px-4 pt-4 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div className="relative">
        <div
          data-testid="desktop-new-conversation-context"
          className="mx-4 h-14 rounded-t-[1.25rem] bg-muted/70 px-1.5"
        >
          <div className="flex h-10 min-w-0 items-center gap-1 text-xs">
            <Combobox
              items={locations}
              itemToStringLabel={locationLabel}
              value={location}
              onValueChange={(next) => {
                if (next) onLocationChange(next);
              }}
              disabled={promptProps.disabled || contextDisabled}
            >
              <ComboboxTrigger
                aria-label="执行位置"
                className={contextButtonClass}
                render={<Button type="button" variant="ghost" size="sm" />}
              >
                <LocationIcon />
                {location === "local" ? "此计算机" : "云端"}
              </ComboboxTrigger>
              <ComboboxContent side="top" sideOffset={4} className={popupClass}>
                <ContextSearch placeholder="工作位置" />
                <ComboboxEmpty>没有匹配的位置</ComboboxEmpty>
                <ComboboxList className="min-h-0 p-0">
                  {(value) => (
                    <ComboboxItem
                      key={value}
                      value={value}
                      disabled={value === "local" && !localAvailable}
                      className={itemClass}
                    >
                      {value === "local" ? <LaptopIcon /> : <CloudIcon />}
                      {locationLabel(value)}
                      {value === "cloud" && <span className="text-muted-foreground">默认环境</span>}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            {location === "local" ? (
              <Combobox
                items={projects}
                itemToStringLabel={projectName}
                value={project}
                open={projectOpen}
                onOpenChange={setProjectOpen}
                onValueChange={(next) => {
                  if (next) onProjectChange(next);
                }}
                disabled={promptProps.disabled || contextDisabled || selectingProject}
              >
                <ComboboxTrigger
                  aria-label="选择项目"
                  className={contextButtonClass}
                  render={<Button type="button" variant="ghost" size="sm" />}
                >
                  <FolderIcon />
                  <span className="truncate">{selectingProject ? "正在选择…" : projectLabel}</span>
                </ComboboxTrigger>
                <ComboboxContent side="top" sideOffset={4} className={popupClass}>
                  <ContextSearch placeholder="搜索项目" />
                  <ComboboxEmpty>没有匹配的项目</ComboboxEmpty>
                  <ComboboxList className="min-h-0 p-0">
                    {(value) => (
                      <ComboboxItem key={value} value={value} className={itemClass}>
                        <FolderIcon />
                        <span className="truncate">{projectName(value)}</span>
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                  <div className="mt-1 border-t border-border pt-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start rounded-xl px-2.5 font-normal"
                      onClick={() => {
                        setProjectOpen(false);
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
              "[&_[data-slot=input-group]]:min-h-24! [&_[data-slot=input-group]]:rounded-[1.375rem]! [&_[data-slot=input-group]]:border-foreground/10 [&_[data-slot=input-group]]:bg-background! [&_[data-slot=input-group]]:shadow-[0_18px_45px_-28px_rgb(0_0_0/0.35)]",
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
