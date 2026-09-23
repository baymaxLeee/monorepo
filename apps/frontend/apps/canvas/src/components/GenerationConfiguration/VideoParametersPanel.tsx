import { useRef, useState } from "react";

import { Field } from "@/components/Field";
import { Segmented, SegmentedTrack, segmentItemClass } from "@/components/Segmented";
import { InputNumber } from "@/components/ui";
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
    <div className="flex w-[353px] flex-col gap-4 rounded-[12px] border-[0.5px] border-solid border-border bg-white p-3 shadow-[0px_15px_35px_-2px_rgba(0,0,0,0.05),0px_5px_15px_0px_rgba(0,0,0,0.05)]">
      {!hasConfigurableParameter ? (
        <div className="py-4 text-center text-sm text-muted-foreground">{t("当前模型暂无可配置参数")}</div>
      ) : null}

      {showRatio && limits.ratios.length > 0 ? (
        <Field label={t("比例")}>
          <SegmentedTrack>
            {limits.ratios.map((ratio) => (
              <button
                className={`${segmentItemClass(ratio === settings.ratio)} h-[58px] flex-col`}
                key={ratio}
                onClick={() => patch({ ratio })}
                type="button"
              >
                <RatioIcon ratio={ratio} selected={ratio === settings.ratio} />
                {ratioLabel(ratio)}
              </button>
            ))}
          </SegmentedTrack>
        </Field>
      ) : null}

      {limits.resolutions.length > 0 ? (
        <Field label={t("分辨率")}>
          <Segmented
            onChange={(resolution) => patch({ resolution })}
            options={[...limits.resolutions]}
            value={settings.resolution}
          />
        </Field>
      ) : null}

      {showDuration && hasDuration ? (
        <Field label={t("时长")}>
          <div className="flex items-center gap-2">
            {limits.automaticDurationSupported ? (
              <div className="w-[80px]">
                <Segmented
                  getOptionLabel={() => t("自动")}
                  onChange={(duration) => patch({ duration })}
                  options={["-1s"]}
                  value={settings.duration}
                />
              </div>
            ) : null}
            {hasDurationRange ? (
              <InputNumber
                aria-label={t("时长")}
                className="flex-1"
                max={limits.durationMaxSeconds}
                min={limits.durationMinSeconds}
                onBlur={commitDurationNow}
                onChange={(value) => {
                  const seconds = value ?? limits.durationMinSeconds;
                  setDurationDraft(seconds);
                  durationDraftRef.current = seconds;
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    commitDurationNow();
                  }
                }}
                precision={0}
                suffix={t("秒")}
                value={durationDraft ?? manualDuration}
              />
            ) : null}
          </div>
        </Field>
      ) : null}

      {limits.audios.length > 0 ? (
        <Field label={t("输出声音")}>
          <Segmented
            getOptionLabel={(option) => AUDIO_LABELS[option] ?? option}
            onChange={(audio) => patch({ audio })}
            options={[...limits.audios]}
            value={settings.audio}
          />
        </Field>
      ) : null}

      {limits.watermarks.length > 0 ? (
        <Field label={t("水印")}>
          <Segmented
            getOptionLabel={(option) => WATERMARK_LABELS[option] ?? option}
            onChange={(watermark) => patch({ watermark })}
            options={[...limits.watermarks]}
            value={settings.watermark}
          />
        </Field>
      ) : null}
    </div>
  );
}
