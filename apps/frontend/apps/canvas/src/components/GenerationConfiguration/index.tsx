import { Check as IconCheck, ChevronDown as IconDown } from "lucide-react";
import { type ReactNode, useEffect } from "react";

import { Select, Dropdown, type DropdownProps, Trigger } from "@/components/ui";
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
export type PopupPosition = DropdownProps["position"];

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
  popupZIndex?: number;
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
  "flex h-8 items-center gap-2 rounded-[8px] bg-[rgba(26,27,30,0.05)] px-3 text-[13px] font-medium leading-5.5 text-[color:var(--color-text-2)]";
const MODES = [
  { label: t("全能参考"), value: canvasnode.CanvasVideoInputMode.REFERENCE },
  {
    label: t("首尾帧"),
    value: canvasnode.CanvasVideoInputMode.FIRST_LAST_FRAME,
  },
];

function Divider() {
  return <span className="h-3 w-[1px] shrink-0 bg-[color:var(--color-border-3)]" />;
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
    <Select
      bordered={false}
      className={`${
        compact ? "w-[150px] text-[11px]" : "w-[160px]"
      } min-w-[100px] shrink-[10] rounded-[8px] bg-[rgba(26,27,30,0.05)] ${selectDisabled ? "cursor-not-allowed" : ""}`}
      disabled={selectDisabled}
      dropdownMenuClassName="canvas-editor-overlay"
      dropdownRender={(menu) => (
        <div className="p-[6px]">
          <div className="px-3 py-1 text-[12px] leading-5 text-[color:var(--color-text-4)]">
            {t("建议选择与审核素材账号相同的模型")}
          </div>
          {menu}
        </div>
      )}
      onChange={onChange}
      placeholder={t("选择模型")}
      renderFormat={() => modelOptions.find((item) => item.id === model)?.name || model || t("选择模型")}
      triggerProps={{
        autoAlignPopupMinWidth: true,
        autoAlignPopupWidth: false,
        ...(popupPosition ? { position: popupPosition } : {}),
      }}
      value={model || undefined}
    >
      {modelOptions.map((option) => (
        <Select.Option key={option.id} value={option.id}>
          <span className="flex w-full items-center justify-between gap-2">
            <span className="min-w-0 truncate" title={option.name}>
              {renderModelOption?.(option) ?? option.name}
            </span>
            {option.id === model ? (
              <IconCheck
                aria-label={t("已选择")}
                className="shrink-0 text-[16px] text-[color:rgb(var(--success-6))]"
                role="img"
              />
            ) : null}
          </span>
        </Select.Option>
      ))}
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
      bordered={false}
      className={`${compact ? "w-[96px] text-[12px]" : "w-[104px]"} shrink-0 rounded-[8px] bg-[rgba(26,27,30,0.05)] ${disabled ? "cursor-not-allowed" : ""}`}
      disabled={disabled}
      dropdownMenuClassName="canvas-editor-overlay"
      onChange={(raw) => {
        const mode = MODES.find((item) => String(item.value) === raw);
        if (mode) onChange(mode.value);
      }}
      triggerProps={popupPosition ? { position: popupPosition } : undefined}
      value={String(value)}
    >
      {MODES.map((mode) => (
        <Select.Option key={String(mode.value)} value={String(mode.value)}>
          {mode.label}
        </Select.Option>
      ))}
    </Select>
  );
}

function VideoParameters({
  compact,
  disabled,
  fillWidth,
  modelOptions,
  popupPosition,
  popupZIndex,
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
  popupZIndex?: number;
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
    <Dropdown
      disabled={disabled}
      droplist={
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
      }
      position={popupPosition ?? "bl"}
      trigger="click"
      triggerProps={popupZIndex === undefined ? undefined : { style: { zIndex: popupZIndex } }}
    >
      <span
        className={`${CHIP_CLASS} min-w-[88px] shrink overflow-hidden ${fillWidth ? "w-full" : ""} ${compact ? "gap-1 px-2 text-[11px]" : ""} ${disabled ? "cursor-not-allowed text-[color:var(--color-text-4)]" : "cursor-pointer"}`}
      >
        <RatioIcon ratio={settings.ratio} />
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        <IconDown
          className={`shrink-0 text-[12px] ${disabled ? "text-[color:var(--color-text-4)]" : "text-[color:var(--color-text-3)]"}`}
        />
      </span>
    </Dropdown>
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
    popupZIndex,
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
        <Trigger
          disabled={disabled}
          position={popupPosition}
          popup={() => (
            <ImageParametersPanel
              disabledRatioOptions={imageAvailability?.disabledRatios ?? []}
              disabledResolutionOptions={imageAvailability?.disabledResolutions ?? []}
              onChange={emitImage}
              ratioOptions={imageAvailability?.ratios ?? imageOptions.ratios}
              resolutionOptions={imageAvailability?.resolutions ?? imageOptions.resolutions}
              settings={props.imageSettings}
              showWatermark={selectedImageModel?.capabilities.watermarkSupported === true}
            />
          )}
          style={popupZIndex === undefined ? undefined : { zIndex: popupZIndex }}
          trigger="click"
        >
          <span
            className={`${CHIP_CLASS} ${
              disabled ? "cursor-not-allowed text-[color:var(--color-text-4)]" : "cursor-pointer"
            }`}
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
            <IconDown
              className={`text-[12px] ${
                disabled ? "text-[color:var(--color-text-4)]" : "text-[color:var(--color-text-3)]"
              }`}
            />
          </span>
        </Trigger>
      ) : null}
      {props.parameters === "video" ? (
        <VideoParameters
          compact={compact}
          disabled={disabled}
          fillWidth={props.fillParameterWidth === true}
          modelOptions={modelOptions}
          onChange={emitVideo}
          popupPosition={popupPosition}
          popupZIndex={popupZIndex}
          settings={props.videoSettings}
          showDuration={props.showDuration !== false}
          showRatio={showRatio}
          summaryKeys={props.summaryKeys ?? SUMMARY_KEYS}
        />
      ) : null}
    </div>
  );
}
