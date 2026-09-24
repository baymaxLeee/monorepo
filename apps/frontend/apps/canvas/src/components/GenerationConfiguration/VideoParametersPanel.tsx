import {
  FieldSet,
  FieldLegend,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  ToggleGroup,
  ToggleGroupItem,
} from "@repo/design-system";
import { useRef, useState } from "react";

import t from "@/utils/i18n";

import { RatioIcon } from "./RatioIcon";
import { DEFAULT_GENERATION_SETTINGS, type GenerationSettings, type VideoModelParamConfig } from "./videoModelConfig";

export { DEFAULT_GENERATION_SETTINGS, type GenerationSettings };

const AUDIO_LABELS: Record<string, string> = {
  有声: t("有声"),
  无声: t("无声"),
};

const WATERMARK_LABELS: Record<string, string> = {
  有水印: t("有水印"),
  无水印: t("无水印"),
};

function ratioLabel(ratio: string) {
  return ratio === "adaptive" ? t("自动") : ratio;
}

function ParameterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <FieldSet className="gap-1">
      <FieldLegend className="text-xs text-muted-foreground" variant="label">
        {label}
      </FieldLegend>
      {children}
    </FieldSet>
  );
}

function ParameterToggleGroup({
  options,
  value,
  getLabel = (item) => item,
  onChange,
}: {
  options: readonly string[];
  value: string;
  getLabel?: (item: string) => string;
  onChange: (value: string) => void;
}) {
  return (
    <ToggleGroup
      className="w-full items-stretch rounded-lg bg-muted p-1"
      onValueChange={(next) => next[0] && onChange(next[0])}
      spacing={0}
      value={[value]}
    >
      {options.map((option) => (
        <ToggleGroupItem
          aria-label={getLabel(option)}
          className="h-6 flex-1 rounded-md aria-pressed:bg-background aria-pressed:shadow-sm"
          key={option}
          value={option}
        >
          {getLabel(option)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function parseDurationSeconds(duration: string) {
  const seconds = Number.parseInt(duration, 10);
  return Number.isFinite(seconds) ? seconds : 0;
}

function clampDurationSeconds(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * 比例、分辨率、时长、声音、水印收进同一个 353px 宽的下拉面板。
 * 时长输入期间只更新本地草稿，失焦、回车或切换其它参数时再一次性校验并提交。
 */
export function VideoParametersPanel({
  modelParamConfig,
  settings,
  showDuration = true,
  showRatio = true,
  onChange,
}: {
  modelParamConfig: VideoModelParamConfig;
  settings: GenerationSettings;
  /** 批量分镜首屏已单独展示分镜时长时，参数下拉里不再重复配置时长。 */
  showDuration?: boolean;
  showRatio?: boolean;
  onChange: (settings: GenerationSettings) => void;
}) {
  const { limits } = modelParamConfig;
  const hasDurationRange = limits.durationMinSeconds > 0 && limits.durationMaxSeconds >= limits.durationMinSeconds;
  const hasDuration = limits.automaticDurationSupported || hasDurationRange;
  const hasConfigurableParameter =
    (showRatio && limits.ratios.length > 0) ||
    limits.resolutions.length > 0 ||
    (showDuration && hasDuration) ||
    limits.audios.length > 0 ||
    limits.watermarks.length > 0;
  const committedDuration = parseDurationSeconds(settings.duration);
  const manualDuration =
    committedDuration > 0 ? committedDuration : limits.durationDefaultSeconds || limits.durationMinSeconds;
  const [durationDraft, setDurationDraft] = useState<number | undefined>();
  const durationDraftRef = useRef<number | undefined>(undefined);

  const commitDurationNow = () => {
    const draft = durationDraftRef.current;
    if (draft === undefined) return;
    const seconds = clampDurationSeconds(draft, limits.durationMinSeconds, limits.durationMaxSeconds);
    setDurationDraft(undefined);
    durationDraftRef.current = undefined;
    if (seconds !== parseDurationSeconds(settings.duration)) {
      onChange({ ...settings, duration: `${seconds}s` });
    }
  };

  const patch = (part: Partial<GenerationSettings>) => {
    // 改其它项前先带上未提交的时长草稿，避免点选比例/分辨率时丢掉 30s。
    const draft = durationDraftRef.current;
    const durationPart =
      draft === undefined || part.duration !== undefined
        ? {}
        : {
            duration: `${clampDurationSeconds(draft, limits.durationMinSeconds, limits.durationMaxSeconds)}s`,
          };
    setDurationDraft(undefined);
    durationDraftRef.current = undefined;
    onChange({ ...settings, ...durationPart, ...part });
  };

  return (
    <div className="flex w-[353px] flex-col gap-4 rounded-xl bg-popover p-3 text-popover-foreground">
      {!hasConfigurableParameter ? (
        <div className="py-4 text-center text-sm text-muted-foreground">{t("当前模型暂无可配置参数")}</div>
      ) : null}

      {showRatio && limits.ratios.length > 0 ? (
        <ParameterGroup label={t("比例")}>
          <ToggleGroup
            className="w-full items-stretch rounded-lg bg-muted p-1"
            onValueChange={(next) => next[0] && patch({ ratio: next[0] })}
            spacing={0}
            value={[settings.ratio]}
          >
            {limits.ratios.map((ratio) => (
              <ToggleGroupItem
                className="h-[58px] flex-1 flex-col rounded-md aria-pressed:bg-background aria-pressed:shadow-sm"
                key={ratio}
                value={ratio}
              >
                <RatioIcon ratio={ratio} selected={ratio === settings.ratio} />
                {ratioLabel(ratio)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </ParameterGroup>
      ) : null}

      {limits.resolutions.length > 0 ? (
        <ParameterGroup label={t("分辨率")}>
          <ParameterToggleGroup
            onChange={(resolution) => patch({ resolution })}
            options={[...limits.resolutions]}
            value={settings.resolution}
          />
        </ParameterGroup>
      ) : null}

      {showDuration && hasDuration ? (
        <ParameterGroup label={t("时长")}>
          <div className="flex items-center gap-2">
            {limits.automaticDurationSupported ? (
              <div className="w-[80px]">
                <ParameterToggleGroup
                  getLabel={() => t("自动")}
                  onChange={(duration) => patch({ duration })}
                  options={["-1s"]}
                  value={settings.duration}
                />
              </div>
            ) : null}
            {hasDurationRange ? (
              <InputGroup className="flex-1">
                <InputGroupInput
                  aria-label={t("时长")}
                  max={limits.durationMaxSeconds}
                  min={limits.durationMinSeconds}
                  onBlur={commitDurationNow}
                  onChange={(event) => {
                    const seconds = Number.isNaN(event.currentTarget.valueAsNumber)
                      ? limits.durationMinSeconds
                      : event.currentTarget.valueAsNumber;
                    setDurationDraft(seconds);
                    durationDraftRef.current = seconds;
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitDurationNow();
                  }}
                  step={1}
                  type="number"
                  value={durationDraft ?? manualDuration}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>{t("秒")}</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            ) : null}
          </div>
        </ParameterGroup>
      ) : null}

      {limits.audios.length > 0 ? (
        <ParameterGroup label={t("输出声音")}>
          <ParameterToggleGroup
            getLabel={(option) => AUDIO_LABELS[option] ?? option}
            onChange={(audio) => patch({ audio })}
            options={[...limits.audios]}
            value={settings.audio}
          />
        </ParameterGroup>
      ) : null}

      {limits.watermarks.length > 0 ? (
        <ParameterGroup label={t("水印")}>
          <ParameterToggleGroup
            getLabel={(option) => WATERMARK_LABELS[option] ?? option}
            onChange={(watermark) => patch({ watermark })}
            options={[...limits.watermarks]}
            value={settings.watermark}
          />
        </ParameterGroup>
      ) : null}
    </div>
  );
}
