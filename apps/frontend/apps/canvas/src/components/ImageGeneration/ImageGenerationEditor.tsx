import { Button, Textarea, Tooltip, TooltipContent, TooltipTrigger } from "@repo/design-system";
import { Minimize2 as IconAbbreviation, Maximize2 as IconUnfold } from "lucide-react";

import {
  GenerationConfiguration,
  type ImageGenerationCapabilities,
  type ImageGenerationSettings,
  type PopupPosition,
} from "@/components/GenerationConfiguration/index";
import t from "@/utils/i18n";

import { AssetStrip } from "../../pages/studio/components/AssetStrip";
import type { StoryboardAsset } from "../../pages/studio/domain/types";

import styles from "./ImageGenerationEditor.module.less";

const REFERENCE_CATEGORIES = ["image"] as const;

export interface ImageGenerationEditorModel {
  id: string;
  name: string;
  supportsTextToImage: boolean;
  supportsImageToImage: boolean;
  capabilities: ImageGenerationCapabilities;
}

export interface ImageGenerationEditorProps {
  canGenerate: boolean;
  expanded?: boolean;
  generating: boolean;
  modelOptions: ImageGenerationEditorModel[];
  modelsLoading: boolean;
  onCollapse?: () => void;
  onExpand?: () => void;
  onGenerate: () => void | Promise<void>;
  onPromptChange: (prompt: string) => void;
  onReferenceRemove: (id: string) => void;
  onReferenceUpload: (files: File[]) => void | Promise<void>;
  onSettingsChange: (settings: ImageGenerationSettings) => void;
  onSettingsValidationChange?: (error: string | undefined) => void;
  popupPosition?: PopupPosition;
  prompt: string;
  promptPlaceholder: string;
  referenceImageLimit: number;
  references: StoryboardAsset[];
  requiresReference: boolean;
  selectedModel?: ImageGenerationEditorModel;
  settings: ImageGenerationSettings;
  settingsError?: string;
  supportsImageToImage: boolean;
  title?: string;
}

/** API 无关的受控生图编辑器，可由资源素材和画布节点分别注入业务动作。 */
export function ImageGenerationEditor({
  canGenerate,
  expanded = false,
  generating,
  modelOptions,
  modelsLoading,
  onCollapse,
  onExpand,
  onGenerate,
  onPromptChange,
  onReferenceRemove,
  onReferenceUpload,
  onSettingsChange,
  onSettingsValidationChange,
  popupPosition,
  prompt,
  promptPlaceholder,
  referenceImageLimit,
  references,
  requiresReference,
  selectedModel,
  settings,
  settingsError,
  supportsImageToImage,
  title,
}: ImageGenerationEditorProps) {
  return (
    <section
      className={
        expanded
          ? `${styles.expanded} flex flex-col justify-between`
          : "rounded-[20px] border border-border bg-background p-3 shadow-md"
      }
    >
      <div className={`flex min-h-0 flex-col ${expanded ? "flex-1 gap-5" : "h-[200px] gap-3"}`}>
        {expanded ? (
          <div className="flex items-center justify-between">
            <div className="truncate text-[14px] font-medium leading-6 text-foreground">{title}</div>
            <Button
              aria-label={t("收起生图编辑器")}
              className={`${styles.fullscreenButton} flex h-6 w-6 shrink-0 items-center justify-center p-0 text-[20px]`}
              disabled={generating}
              onClick={onCollapse}
              variant="ghost"
            >
              <IconAbbreviation />
            </Button>
          </div>
        ) : null}
        <div className="flex items-start justify-between">
          <div className={generating ? styles.disabledEditorArea : undefined}>
            <AssetStrip
              editable={!generating && (supportsImageToImage || references.length > 0)}
              assets={references}
              assetLimits={{ image: referenceImageLimit, video: 0, audio: 0 }}
              categories={[...REFERENCE_CATEGORIES]}
              emptyHint={
                requiresReference
                  ? t("当前模型需要至少一张参考图")
                  : selectedModel && !supportsImageToImage
                    ? t("当前模型仅支持文生图")
                    : ""
              }
              onRemove={onReferenceRemove}
              onUpload={onReferenceUpload}
              showStats={expanded}
              statsLabel={t("参考图统计")}
            />
          </div>
          {onExpand ? (
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex max-w-full" />}>
                <Button
                  aria-label={t("展开生图编辑器")}
                  className={`${styles.fullscreenButton} flex h-6 w-6 shrink-0 items-center justify-center p-0 text-[16px]`}
                  disabled={generating}
                  onClick={onExpand}
                  variant="ghost"
                >
                  <IconUnfold />
                </Button>
              </TooltipTrigger>
              <TooltipContent side={"top"}>{t("大窗口编辑")}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        <Textarea
          aria-label={title ? t("{title}提示词", { title }) : t("生图提示词")}
          className={`m-0 min-h-0 w-full flex-1 resize-none border-0 bg-[transparent] p-0 text-[13px] leading-5.5 text-foreground outline-none placeholder:text-muted-foreground ${
            generating ? styles.disabledEditorArea : ""
          }`}
          disabled={generating}
          maxLength={1000}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder={promptPlaceholder}
          value={prompt}
        />
      </div>
      <div className={`flex items-center justify-between gap-3 ${expanded ? "" : "mt-5"}`}>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <GenerationConfiguration
            disabled={generating}
            imageSettings={settings}
            modelOptions={modelOptions}
            modelsLoading={modelsLoading}
            onImageSettingsChange={onSettingsChange}
            onValidationChange={onSettingsValidationChange}
            parameters="image"
            popupPosition={popupPosition}
          />
        </div>
        <div className="flex items-center gap-2">
          {settingsError ? <span className="text-[12px] leading-5 text-destructive">{settingsError}</span> : null}
          {!generating ? (
            <Button disabled={!canGenerate} onClick={() => void onGenerate()} variant="default">
              {t("生成")}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
