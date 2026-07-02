import type { ModelProvider } from "api";
import { Button, Switch } from "components";
import { ModelSelector } from "components/ai-chat";
import {
  BotIcon,
  BrainIcon,
  ImageIcon,
  ListChecksIcon,
  VideoIcon,
} from "lucide-react";

export interface ChatComposerControlsProps {
  providers: ModelProvider[];
  selectedProviderId: string | null;
  onSelectProvider: (id: string) => void;
  selectedImageProviderId: string | null;
  onSelectImageProvider: (id: string) => void;
  selectedVideoProviderId: string | null;
  onSelectVideoProvider: (id: string) => void;
  thinking: boolean;
  onThinkingChange: (next: boolean) => void;
  disabled?: boolean;
  mode: "normal" | "plan";
  onModeChange: (mode: "normal" | "plan") => void;
}

export function ChatComposerControls({
  providers,
  selectedProviderId,
  onSelectProvider,
  selectedImageProviderId,
  onSelectImageProvider,
  selectedVideoProviderId,
  onSelectVideoProvider,
  thinking,
  onThinkingChange,
  disabled,
  mode,
  onModeChange,
}: ChatComposerControlsProps) {
  const options = providers
    .filter(
      (provider) =>
        provider.is_enabled && (provider.provider_kind ?? "chat") === "chat",
    )
    .map((provider) => ({
      id: provider.id,
      label: provider.name,
      description: provider.model,
      badge: provider.is_default ? "默认" : undefined,
    }));

  const imageOptions = providers
    .filter(
      (provider) => provider.is_enabled && provider.provider_kind === "image",
    )
    .map((provider) => ({
      id: provider.id,
      label: provider.name,
      description: provider.model,
    }));

  const videoOptions = providers
    .filter(
      (provider) => provider.is_enabled && provider.provider_kind === "video",
    )
    .map((provider) => ({
      id: provider.id,
      label: provider.name,
      description: provider.model,
    }));

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 rounded-full px-2.5 text-xs text-muted-foreground hover:text-foreground"
        disabled={disabled}
        onClick={() => onModeChange(mode === "plan" ? "normal" : "plan")}
      >
        {mode === "plan" ? (
          <ListChecksIcon className="size-3.5" />
        ) : (
          <BotIcon className="size-3.5" />
        )}
        {mode === "plan" ? "Plan" : "Agent"}
      </Button>
      {/* Model selectors only affect the NEXT request, so keep them usable
          even while a run streams — a slow reasoning turn should not lock the
          user out of picking a model (or turning off thinking) for the next
          message. Only server-side actions (mode switch) stay disabled. */}
      <ModelSelector
        value={selectedProviderId}
        options={options}
        onValueChange={onSelectProvider}
        placeholder="选择模型"
        disabled={options.length === 0}
      />
      {imageOptions.length > 0 ? (
        <span className="flex items-center gap-1 rounded-full text-muted-foreground">
          <ImageIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <ModelSelector
            value={selectedImageProviderId}
            options={imageOptions}
            onValueChange={onSelectImageProvider}
            placeholder="图片模型"
          />
        </span>
      ) : null}
      {videoOptions.length > 0 ? (
        <span className="flex items-center gap-1 rounded-full text-muted-foreground">
          <VideoIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <ModelSelector
            value={selectedVideoProviderId}
            options={videoOptions}
            onValueChange={onSelectVideoProvider}
            placeholder="视频模型"
          />
        </span>
      ) : null}
      <span className="flex items-center gap-1.5 rounded-full px-2 text-xs text-muted-foreground">
        <BrainIcon className="size-3.5" />
        <span>思考</span>
        <Switch
          checked={thinking}
          onCheckedChange={onThinkingChange}
          aria-label="切换思考模式"
        />
      </span>
    </>
  );
}
