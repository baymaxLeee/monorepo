import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/design-system";
import { ChevronDown as IconDown } from "lucide-react";
import { type ReactNode, useEffect } from "react";

import { canvasnode } from "@/domain";
import t from "@/utils/i18n";

import {
  IMAGE_PARAMETER_OPTIONS,
  type ImageGenerationCapabilities,
  imageGenerationOptionAvailability,
  normalizeImageGenerationSettings,
  validateImageGenerationSettings,
} from "./imageModelConfig";
import { type ImageGenerationSettings, ImageParametersPanel } from "./ImageParametersPanel";
import { RatioIcon } from "./RatioIcon";
import { getVideoModelParamConfigByOption, sanitizeGenerationSettings } from "./videoModelConfig";
import { type GenerationSettings, VideoParametersPanel } from "./VideoParametersPanel";

export { DEFAULT_IMAGE_GENERATION_SETTINGS, type ImageGenerationSettings } from "./ImageParametersPanel";
export { DEFAULT_GENERATION_SETTINGS, type GenerationSettings } from "./VideoParametersPanel";
export type { ImageGenerationCapabilities } from "./imageModelConfig";
export type PopupPosition = "top" | "bottom" | "left" | "right" | "tl" | "tr" | "bl" | "br";

function selectPlacement(position: PopupPosition = "bottom") {
  const side = ({ t: "top", b: "bottom", l: "left", r: "right" } as const)[position[0] as "t" | "b" | "l" | "r"];
  const align = position.length === 2 ? ("lt".includes(position[1]) ? "start" : "end") : "center";
  return { side, align } as const;
}

export interface GenerationModelOption {
  id: string;
  name: string;
  durationMinSeconds?: number;
  durationMaxSeconds?: number;
  durationDefaultSeconds?: number;
  durationRecommendsSeconds?: readonly number[];
  durationRecommendDefaultSeconds?: number;
  ratioDefault?: string;
  ratios?: readonly string[];
  resolutionDefault?: string;
  resolutions?: readonly string[];
  audioDefault?: string;
  audios?: readonly string[];
  watermarkDefault?: string;
  watermarks?: readonly string[];
  assetLimits?: Partial<{ image: number; video: number; audio: number }>;
}

export interface ImageGenerationModelOption extends GenerationModelOption {
  capabilities: ImageGenerationCapabilities;
}

interface CommonProps {
  compact?: boolean;
  disabled?: boolean;
  fitContent?: boolean;
  modelOptions?: GenerationModelOption[];
  modelsLoading?: boolean;
  popupPosition?: PopupPosition;
  renderModelOption?: (model: GenerationModelOption) => ReactNode;
}

interface ImageProps extends Omit<CommonProps, "modelOptions"> {
  imageSettings: ImageGenerationSettings;
  modelOptions?: ImageGenerationModelOption[];
  onImageSettingsChange: (settings: ImageGenerationSettings) => void;
  onValidationChange?: (error: string | undefined) => void;
  parameters: "image";
}

interface VideoProps extends CommonProps {
  fillParameterWidth?: boolean;
  generationMode?: canvasnode.CanvasVideoInputMode;
  generationModeDisabled?: boolean;
  onGenerationModeChange?: (mode: canvasnode.CanvasVideoInputMode) => void;
  onVideoSettingsChange: (settings: GenerationSettings) => void;
  parameters: "video";
  showDuration?: boolean;
  showModel?: boolean;
  summaryKeys?: (keyof Omit<GenerationSettings, "model">)[];
  videoSettings: GenerationSettings;
}

export type GenerationConfigurationProps = ImageProps | VideoProps;

const SUMMARY_KEYS: (keyof Omit<GenerationSettings, "model">)[] = [
  "ratio",
  "resolution",
  "duration",
  "audio",
  "watermark",
];
const CHIP_CLASS =
  "flex h-8 items-center gap-2 rounded-[8px] bg-[rgba(26,27,30,0.05)] px-3 text-[13px] font-medium leading-5.5 text-foreground";
const MODES = [
  { label: t("全能参考"), value: canvasnode.CanvasVideoInputMode.REFERENCE },
  {
    label: t("首尾帧"),
    value: canvasnode.CanvasVideoInputMode.FIRST_LAST_FRAME,
  },
];

function Divider() {
  return <span className="h-3 w-[1px] shrink-0 bg-border" />;
}

function ModelSelector({
  compact,
  disabled,
  model,
  modelOptions,
  modelsLoading,
  popupPosition,
  renderModelOption,
  onChange,
}: {
  compact: boolean;
  disabled: boolean;
  model: string;
  modelOptions: GenerationModelOption[];
  modelsLoading: boolean;
  popupPosition?: PopupPosition;
  renderModelOption?: (model: GenerationModelOption) => ReactNode;
  onChange: (model: string) => void;
}) {
  const selectDisabled = disabled || modelsLoading || modelOptions.length === 0;
  return (
    <Select disabled={selectDisabled} onValueChange={(value) => value && onChange(value)} value={model || undefined}>
      <SelectTrigger
        aria-label={t("生成模型")}
        className={`${compact ? "w-[150px] text-[11px]" : "w-[160px]"} min-w-[100px] shrink-[10] border-0 bg-muted shadow-none`}
      >
        <SelectValue placeholder={t("选择模型")}>
          {modelOptions.find((item) => item.id === model)?.name || model || undefined}
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        {...selectPlacement(popupPosition)}
        alignItemWithTrigger={false}
        className="canvas-editor-overlay w-max min-w-(--anchor-width) p-1"
      >
        <div className="px-2 py-1 text-xs text-muted-foreground">{t("建议选择与审核素材账号相同的模型")}</div>
        {modelOptions.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            <span className="flex w-full items-center justify-between gap-2">
              <span className="min-w-0 truncate" title={option.name}>
                {renderModelOption?.(option) ?? option.name}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ModeSelector({
  compact,
  disabled,
  popupPosition,
  value,
  onChange,
}: {
  compact: boolean;
  disabled: boolean;
  popupPosition?: PopupPosition;
  value: canvasnode.CanvasVideoInputMode;
  onChange: (value: canvasnode.CanvasVideoInputMode) => void;
}) {
  return (
    <Select
      disabled={disabled}
      onValueChange={(raw) => {
        const mode = MODES.find((item) => String(item.value) === raw);
        if (mode) onChange(mode.value);
      }}
      value={String(value)}
    >
      <SelectTrigger
        aria-label={t("生成模式")}
        className={`${compact ? "w-[96px] text-xs" : "w-[104px]"} shrink-0 border-0 bg-muted shadow-none`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent {...selectPlacement(popupPosition)} alignItemWithTrigger={false} className="canvas-editor-overlay">
        {MODES.map((mode) => (
          <SelectItem key={String(mode.value)} value={String(mode.value)}>
            {mode.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function VideoParameters({
  compact,
  disabled,
  fillWidth,
  modelOptions,
  popupPosition,
  settings,
  showDuration,
  showRatio,
  summaryKeys,
  onChange,
}: {
  compact: boolean;
  disabled: boolean;
  fillWidth: boolean;
  modelOptions: GenerationModelOption[];
  popupPosition?: PopupPosition;
  settings: GenerationSettings;
  showDuration: boolean;
  showRatio: boolean;
  summaryKeys: (keyof Omit<GenerationSettings, "model">)[];
  onChange: (settings: GenerationSettings) => void;
}) {
  const config = getVideoModelParamConfigByOption(settings.model, modelOptions);
  const keys = showRatio ? summaryKeys : summaryKeys.filter((key) => key !== "ratio");
  if (keys.length === 0) return null;
  const summary = keys
    .map((key) => {
      if (key === "duration" && settings[key] === "-1s") return t("自动");
      if (key === "ratio" && settings[key] === "adaptive") return t("自动");
      return settings[key];
    })
    .join(" · ");
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            aria-label={t("调整视频生成参数")}
            className={`${CHIP_CLASS} min-w-[88px] shrink overflow-hidden border-0 shadow-none ${fillWidth ? "w-full" : ""} ${compact ? "gap-1 px-2 text-[11px]" : ""}`}
            disabled={disabled}
            variant="secondary"
          />
        }
      >
        <RatioIcon ratio={settings.ratio} />
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        <IconDown aria-hidden="true" className="shrink-0 text-muted-foreground" data-icon="inline-end" />
      </PopoverTrigger>
      <PopoverContent
        {...selectPlacement(popupPosition ?? "bl")}
        className="canvas-editor-overlay w-auto p-0"
        initialFocus={false}
      >
        <div data-canvas-editor-overlay>
          <VideoParametersPanel
            key={config.modelId}
            modelParamConfig={config}
            onChange={onChange}
            settings={settings}
            showDuration={showDuration}
            showRatio={showRatio}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function GenerationConfiguration(props: GenerationConfigurationProps) {
  const {
    compact = false,
    disabled = false,
    fitContent = false,
    modelOptions = [],
    modelsLoading = false,
    popupPosition,
    renderModelOption,
  } = props;
  const model = props.parameters === "image" ? props.imageSettings.model : props.videoSettings.model;
  const imageOptions = props.parameters === "image" ? IMAGE_PARAMETER_OPTIONS : undefined;

  const emitImage = (next: ImageGenerationSettings) => {
    if (props.parameters !== "image" || !imageOptions) return;
    const selected = props.modelOptions?.find((item) => item.id === next.model);
    const preferred =
      next.model === props.imageSettings.model && next.ratio !== props.imageSettings.ratio ? "ratio" : "resolution";
    const normalized = selected
      ? normalizeImageGenerationSettings(selected, imageOptions.resolutions, imageOptions.ratios, next, preferred)
      : undefined;
    props.onImageSettingsChange({
      ...next,
      ...normalized,
      watermark: selected?.capabilities.watermarkSupported ? next.watermark : false,
    });
  };

  useEffect(() => {
    if (props.parameters !== "image" || props.disabled || modelsLoading || !imageOptions) return;
    const selected = props.modelOptions?.find((item) => item.id === props.imageSettings.model);
    const first = props.modelOptions?.[0];
    if (!selected && !props.imageSettings.model && first) {
      emitImage({
        ...props.imageSettings,
        model: first.id,
        watermark: first.capabilities.watermarkSupported && first.capabilities.watermarkEnabled,
      });
      return;
    }
    if (!selected) return;
    const normalized = normalizeImageGenerationSettings(
      selected,
      imageOptions.resolutions,
      imageOptions.ratios,
      props.imageSettings,
      "resolution",
    );
    const watermark = selected.capabilities.watermarkSupported ? props.imageSettings.watermark : false;
    if (
      normalized &&
      (normalized.ratio !== props.imageSettings.ratio ||
        normalized.resolution !== props.imageSettings.resolution ||
        watermark !== props.imageSettings.watermark)
    ) {
      props.onImageSettingsChange({
        ...props.imageSettings,
        ...normalized,
        watermark,
      });
    }
  }, [imageOptions, modelsLoading, props]);

  useEffect(() => {
    if (props.parameters !== "video" || props.disabled || modelsLoading) return;
    const selected = modelOptions.find((item) => item.id === props.videoSettings.model);
    const model = selected?.id ?? modelOptions[0]?.id;
    if (!model) return;
    const normalized = sanitizeGenerationSettings(
      { ...props.videoSettings, model },
      getVideoModelParamConfigByOption(model, modelOptions),
    );
    if (
      Object.keys(normalized).some(
        (key) => normalized[key as keyof GenerationSettings] !== props.videoSettings[key as keyof GenerationSettings],
      )
    ) {
      props.onVideoSettingsChange(normalized);
    }
  }, [modelOptions, modelsLoading, props]);

  const emitVideo = (next: GenerationSettings) => {
    if (props.parameters !== "video") return;
    props.onVideoSettingsChange(
      sanitizeGenerationSettings(next, getVideoModelParamConfigByOption(next.model, modelOptions)),
    );
  };
  const changeModel = (nextModel: string) => {
    if (props.parameters === "image") {
      emitImage({ ...props.imageSettings, model: nextModel });
    } else {
      const config = getVideoModelParamConfigByOption(nextModel, modelOptions);
      emitVideo({ model: nextModel, ...config.defaults });
    }
  };
  const showRatio =
    props.parameters !== "video" || props.generationMode !== canvasnode.CanvasVideoInputMode.FIRST_LAST_FRAME;
  const selectedImageModel =
    props.parameters === "image"
      ? props.modelOptions?.find((item) => item.id === props.imageSettings.model)
      : undefined;
  const imageValidationError =
    props.parameters === "image" && selectedImageModel
      ? validateImageGenerationSettings(selectedImageModel, props.imageSettings.resolution, props.imageSettings.ratio)
      : undefined;
  const onImageValidationChange = props.parameters === "image" ? props.onValidationChange : undefined;

  useEffect(() => {
    onImageValidationChange?.(imageValidationError);
  }, [imageValidationError, onImageValidationChange]);

  const imageAvailability =
    props.parameters === "image" && selectedImageModel && imageOptions
      ? imageGenerationOptionAvailability(
          selectedImageModel,
          imageOptions.resolutions,
          imageOptions.ratios,
          props.imageSettings.resolution,
          props.imageSettings.ratio,
        )
      : undefined;

  return (
    <div
      className={`flex h-8 min-w-0 items-center ${fitContent ? "shrink" : "flex-1"} ${compact ? "gap-2" : "gap-3"} ${
        disabled ? "select-none" : ""
      }`}
    >
      {props.parameters !== "video" || props.showModel !== false ? (
        <ModelSelector
          compact={compact}
          disabled={disabled}
          model={model}
          modelOptions={modelOptions}
          modelsLoading={modelsLoading}
          onChange={changeModel}
          popupPosition={popupPosition}
          renderModelOption={renderModelOption}
        />
      ) : null}
      {props.parameters === "video" && props.generationMode !== undefined && props.onGenerationModeChange ? (
        <ModeSelector
          compact={compact}
          disabled={disabled || props.generationModeDisabled === true}
          onChange={props.onGenerationModeChange}
          popupPosition={popupPosition}
          value={props.generationMode}
        />
      ) : null}
      {props.parameters === "image" && imageOptions ? (
        <Popover>
          <PopoverTrigger
            render={
              <Button
                aria-label={t("调整图片生成参数")}
                className={`${CHIP_CLASS} border-0 shadow-none`}
                disabled={disabled}
                variant="secondary"
              />
            }
          >
            <RatioIcon ratio={props.imageSettings.ratio} />
            <span className="min-w-[30px] text-center">{props.imageSettings.ratio}</span>
            <Divider />
            <span className="min-w-[40px] text-center">{props.imageSettings.resolution}</span>
            {selectedImageModel?.capabilities.watermarkSupported ? (
              <>
                <Divider />
                <span className="min-w-[40px] text-center">
                  {props.imageSettings.watermark ? t("有水印") : t("无水印")}
                </span>
              </>
            ) : null}
            <IconDown aria-hidden="true" className="text-muted-foreground" data-icon="inline-end" />
          </PopoverTrigger>
          <PopoverContent
            {...selectPlacement(popupPosition)}
            className="canvas-editor-overlay w-auto p-0"
            initialFocus={false}
          >
            <ImageParametersPanel
              disabledRatioOptions={imageAvailability?.disabledRatios ?? []}
              disabledResolutionOptions={imageAvailability?.disabledResolutions ?? []}
              onChange={emitImage}
              ratioOptions={imageAvailability?.ratios ?? imageOptions.ratios}
              resolutionOptions={imageAvailability?.resolutions ?? imageOptions.resolutions}
              settings={props.imageSettings}
              showWatermark={selectedImageModel?.capabilities.watermarkSupported === true}
            />
          </PopoverContent>
        </Popover>
      ) : null}
      {props.parameters === "video" ? (
        <VideoParameters
          compact={compact}
          disabled={disabled}
          fillWidth={props.fillParameterWidth === true}
          modelOptions={modelOptions}
          onChange={emitVideo}
          popupPosition={popupPosition}
          settings={props.videoSettings}
          showDuration={props.showDuration !== false}
          showRatio={showRatio}
          summaryKeys={props.summaryKeys ?? SUMMARY_KEYS}
        />
      ) : null}
    </div>
  );
}
