import { Tooltip, TooltipContent, TooltipTrigger, Button } from "@repo/design-system";
import { MarkdownEditor } from "@repo/editors/markdown-editor";
import { Minimize2 as IconAbbreviation, Maximize2 as IconUnfold } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { GenerationEditorDialog } from "@/components/ImageGeneration/GenerationEditorDialog";
import {
  type AssetMentionItem,
  type AssetMentionSource,
  createAssetMentionExtension,
} from "@/components/promptEditor/index";
import { canvasnode } from "@/domain";
import t from "@/utils/i18n";

import { MaterialMatchButton } from "../../assetMatching/MaterialMatchButton";
import { useMaterialMatching } from "../../assetMatching/useMaterialMatching";
import { AssetStrip } from "../../components/AssetStrip";
import { hasStoryboardScript } from "../../domain/model";
import type { StoryboardAsset } from "../../domain/types";
import { useStudioAssetStore } from "../../store/assets";
import { useCanvasDragging } from "../useCanvasDragging";

import styles from "./CanvasPromptEditor.module.less";

export type CanvasPromptEditorVariant = "text" | "image" | "video";

export interface CanvasPromptEditorProps {
  actionDisabled?: boolean;
  matchProjectId?: string;
  matchTarget?: canvasnode.CanvasNode;
  cancelDisabled?: boolean;
  disabled?: boolean;
  footer: ReactNode;
  initialValue: string;
  generating?: boolean;
  onCancel: () => void;
  onChange: (value: string) => void;
  onGenerate: () => void;
  onSave?: () => Promise<void>;
  onSwapFrames?: () => void;
  queryTree: NonNullable<AssetMentionSource["queryTree"]>;
  references?: StoryboardAsset[];
  reviewAsset?: AssetMentionSource["review"];
  selectAsset: (asset: AssetMentionItem) => Promise<AssetMentionItem>;
  title: string;
  variant: CanvasPromptEditorVariant;
  videoInputMode?: canvasnode.CanvasVideoInputMode;
}

/**
 * 画布生成节点统一提示词编辑器。
 *
 * 直接使用底层 MarkdownEditor 和现有资产 mention 扩展，不复用 PromptEditor
 * 的滚动渐隐外壳；节点类型差异只通过 variant、references 和 footer 注入。
 */
export function CanvasPromptEditor({
  actionDisabled,
  matchTarget,
  matchProjectId,
  cancelDisabled = false,
  disabled = false,
  footer,
  initialValue,
  generating = false,
  onCancel,
  onChange,
  onGenerate,
  onSave,
  onSwapFrames,
  queryTree,
  references = [],
  reviewAsset,
  selectAsset,
  title,
  variant,
  videoInputMode,
}: CanvasPromptEditorProps) {
  const dragging = useCanvasDragging();
  const assetStore = useStudioAssetStore();
  const matching = useMaterialMatching(matchTarget?.NodeID ?? "", matchTarget);
  const showMatch = Boolean(
    matchTarget && variant !== "text" && videoInputMode !== canvasnode.CanvasVideoInputMode.FIRST_LAST_FRAME,
  );

  const [expanded, setExpanded] = useState(false);
  const [value, setValue] = useState(initialValue);
  const persistedValue = useRef(initialValue);
  useEffect(() => {
    const previous = persistedValue.current;
    persistedValue.current = initialValue;
    // Apply server matching results in place without replacing an unsaved draft.
    setValue((current) => (current === previous ? initialValue : current));
  }, [initialValue]);
  const triggerDisabled = matching.matching || (generating && cancelDisabled) || (actionDisabled ?? disabled);
  const extensions = useMemo(
    () => [
      createAssetMentionExtension({
        getSnapshot: assetStore.getSnapshot,
        queryTree,
        review: reviewAsset,
        select: selectAsset,
        subscribe: assetStore.subscribe,
        subscribeMentionIdResolved: assetStore.subscribeMentionIdResolved,
      }),
    ],
    [assetStore, queryTree, reviewAsset, selectAsset, variant],
  );

  const changeValue = (nextValue: string) => {
    setValue(nextValue);
    onChange(nextValue);
  };

  const renderGenerateButton = (large: boolean) => (
    <Button
      variant="ghost"
      className={styles.generateButton}
      disabled={triggerDisabled}
      onClick={() => {
        if (large) setExpanded(false);
        if (generating) onCancel();
        else onGenerate();
      }}
      type="button"
    >
      {generating ? t("停止生成") : triggerDisabled && !matching.matching ? t("生成中") : t("生成")}
    </Button>
  );

  const renderEditor = (large: boolean) => (
    <section
      data-dragging={dragging || undefined}
      className={`${styles.root} ${styles[variant]} ${large ? styles.expanded : ""} nodrag nopan nowheel`}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {large ? (
        <div className={styles.expandedHeader}>
          <div className={styles.expandedTitle}>{title}</div>
          <Button
            variant="ghost"
            aria-label={t("收起提示词编辑器")}
            className={styles.expandButton}
            onClick={() => setExpanded(false)}
            type="button"
          >
            <IconAbbreviation />
          </Button>
        </div>
      ) : null}
      {showMatch ? (
        <div className={styles.matchToolbar}>
          <MaterialMatchButton
            compact
            empty={!hasStoryboardScript(value)}
            disabled={disabled || generating}
            matching={matching.matching}
            cancelling={matching.cancelling}
            onCancel={() => {
              if (matchTarget) void matching.cancel(matchProjectId ?? "", matchTarget.CanvasID);
            }}
            onMatch={() => {
              if (!matchTarget || disabled || generating) return;
              void matching.run(matchProjectId ?? "", matchTarget.CanvasID, async () => {
                await onSave?.();
              });
            }}
          />
          {!large ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    type="button"
                    aria-label={t("展开提示词编辑器")}
                    className={styles.expandButton}
                    onClick={() => setExpanded(true)}
                  >
                    <IconUnfold />
                  </Button>
                }
              />
              <TooltipContent>{t("大窗口编辑")}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      ) : null}
      <div
        className={styles.body}
        data-matching={matching.matching || undefined}
        inert={matching.matching || undefined}
      >
        {references.length > 0 ? (
          <div className={styles.referenceRow}>
            <div className={styles.referenceAssets}>
              <AssetStrip
                assetLimits={{ image: 0, video: 0, audio: 0 }}
                assets={references}
                editable={false}
                interactionDisabled={matching.matching}
                emptyHint=""
                onSwapFrames={onSwapFrames}
                swapFramesDisabled={disabled || generating}
                onRemove={() => undefined}
                onUpload={() => undefined}
                showStats={false}
                videoInputMode={videoInputMode}
              />
            </div>
            {!large && !showMatch ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      aria-label={t("展开提示词编辑器")}
                      className={styles.expandButton}
                      onClick={() => setExpanded(true)}
                      type="button"
                    >
                      <IconUnfold />
                    </Button>
                  }
                />
                <TooltipContent side={"top"}>{t("大窗口编辑")}</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        ) : !large && !showMatch ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  aria-label={t("展开提示词编辑器")}
                  className={`${styles.expandButton} ${styles.expandButtonFloating}`}
                  onClick={() => setExpanded(true)}
                  type="button"
                >
                  <IconUnfold />
                </Button>
              }
            />
            <TooltipContent side={"top"}>{t("大窗口编辑")}</TooltipContent>
          </Tooltip>
        ) : null}
        <MarkdownEditor
          className={styles.editor}
          contentType="markdown"
          editable={!disabled && !matching.matching}
          extensions={extensions}
          features={{
            blockDrag: false,
            blockMenu: false,
            codeBlock: false,
          }}
          onChange={changeValue}
          value={value}
        />
      </div>
      <div className={styles.footer}>
        <div className={styles.settings} inert={matching.matching || undefined}>
          {footer}
        </div>
        {generating && cancelDisabled ? (
          <Tooltip>
            <TooltipTrigger
              render={<span className={styles.generateButtonTooltip}>{renderGenerateButton(large)}</span>}
            />
            <TooltipContent side={"top"}>{t("视频已开始生成，无法取消")}</TooltipContent>
          </Tooltip>
        ) : (
          renderGenerateButton(large)
        )}
      </div>
    </section>
  );

  return (
    <>
      {renderEditor(false)}
      <GenerationEditorDialog onClose={() => setExpanded(false)} visible={expanded}>
        {renderEditor(true)}
      </GenerationEditorDialog>
    </>
  );
}
