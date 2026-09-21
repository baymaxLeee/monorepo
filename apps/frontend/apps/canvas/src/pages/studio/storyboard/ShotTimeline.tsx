import { Plus as IconPlus } from "lucide-react";
import { type DragEvent, type ReactNode, useState } from "react";

import { Dropdown, Menu, Popconfirm, Tooltip } from "@/components/ui";
import {
  HIDDEN_SCROLLBAR_CLASS,
  HIDDEN_SCROLLBAR_STYLE,
  useHorizontalScrollFade,
} from "@/hooks/useHorizontalScrollFade";
import t from "@/utils/i18n";

import type { Shot } from "../domain/types";
import { ScriptDraftCard } from "./ScriptDraftCard";
import { ShotCard } from "./ShotCard";

export type AddShotMode = "single" | "batch";

export interface UnsavedPrompt {
  visible: boolean;
  onSave: () => void;
  onDiscard: () => void;
}

function AddShotGap({ disabled, emphasized, onAdd }: { disabled: boolean; emphasized: boolean; onAdd: () => void }) {
  return (
    <div className="group relative z-[1] h-[78px] w-3 shrink-0">
      <span
        className={`pointer-events-none absolute left-[5px] top-[7px] hidden h-[64px] w-[2px] rounded-[999px] bg-[color:var(--color-border-3)] group-hover:block ${
          emphasized ? "shadow-[0_0_0_2px_#fff]" : ""
        }`}
      />
      <Tooltip content={t("创建分镜")} position="top">
        <button
          aria-label={t("在此处创建分镜")}
          className={`absolute left-[-4px] top-[29px] flex h-5 w-5 items-center justify-center rounded-[999px] border border-solid border-[color:var(--color-border-3)] bg-white p-0 text-[12px] text-[color:var(--color-text-2)] opacity-0 transition-opacity group-hover:opacity-100 ${
            disabled ? "cursor-not-allowed" : "cursor-pointer"
          }`}
          onClick={() => {
            if (!disabled) {
              onAdd();
            }
          }}
          type="button"
        >
          <IconPlus />
        </button>
      </Tooltip>
    </div>
  );
}

export function ShotTimeline({
  addDisabled = false,
  adding = false,
  deleteDisabledReason,
  disabled = false,
  playingId,
  selectedId,
  shots,
  unsavedPrompt,
  onAdd,
  onRemove,
  onReorder,
  onSelect,
}: {
  addDisabled?: boolean;
  adding?: boolean;
  deleteDisabledReason?: string;
  disabled?: boolean;
  playingId?: string;
  selectedId: string;
  shots: Shot[];
  unsavedPrompt?: UnsavedPrompt;
  onAdd: (index: number, mode: AddShotMode) => void;
  onRemove: (id: string) => void;
  onReorder?: (orderedIds: string[]) => void;
  onSelect: (id: string) => void;
}) {
  const [draggingId, setDraggingId] = useState<string>();
  const [insertPosition, setInsertPosition] = useState<{
    shotId: string;
    side: "left" | "right";
  } | null>(null);
  const lockAdd = addDisabled || disabled;
  /** 正式分镜带标签和下方播放三角，时间轴要顶对齐并给外发光留白。 */
  const hasLabeledShot = shots.some((shot) => !shot.storyboardTaskRunId);
  const { contentRef, maskImage, overflowing, scrollRef } = useHorizontalScrollFade();
  const wrapWithUnsavedPrompt = (shotId: string, node: ReactNode) => {
    if (!unsavedPrompt?.visible || shotId !== selectedId) {
      return node;
    }
    return (
      <Popconfirm
        cancelText={t("放弃修改")}
        content={t("当前分镜有未保存的修改，是否保存?")}
        okButtonProps={{ status: "warning" }}
        okText={t("确定保存")}
        onCancel={unsavedPrompt.onDiscard}
        onOk={unsavedPrompt.onSave}
        popupVisible
        position="top"
        title={t("修改尚未保存")}
      >
        {node}
      </Popconfirm>
    );
  };
  const addShotButton = (
    <Dropdown
      disabled={lockAdd}
      droplist={
        <Menu onClickMenuItem={(key) => onAdd(shots.length, key as AddShotMode)}>
          <Menu.Item key="single">{t("单个分镜")}</Menu.Item>
          <Menu.Item key="batch">{t("批量分镜")}</Menu.Item>
        </Menu>
      }
      position="tr"
      trigger="click"
    >
      <button
        aria-label={t("新增分镜")}
        className={`flex h-[78px] w-[78px] shrink-0 items-center justify-center rounded-[12px] border border-dashed border-[color:var(--color-text-4)] bg-white p-0 text-[32px] text-[color:var(--color-text-3)] ${
          lockAdd
            ? "cursor-not-allowed opacity-60"
            : "cursor-pointer hover:border-[color:var(--color-text-3)] hover:text-[color:var(--color-text-1)]"
        }`}
        type="button"
      >
        <IconPlus />
      </button>
    </Dropdown>
  );

  const getInsertSide = (shotId: string, event: DragEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;

    return {
      shotId,
      side: event.clientX < midX ? "left" : "right",
    } as const;
  };

  const clearInsertPosition = () => setInsertPosition(null);

  const handleDrop = (sourceId: string, targetShotId: string, side: "left" | "right") => {
    if (!onReorder) {
      return;
    }

    const orderedIds = shots.filter((item) => !item.storyboardTaskRunId).map((item) => item.id);

    const from = orderedIds.indexOf(sourceId);
    const to = orderedIds.indexOf(targetShotId);
    if (from < 0 || to < 0 || from === to) {
      return;
    }

    const [moved] = orderedIds.splice(from, 1);
    const insertAt = side === "left" ? (to > from ? to - 1 : to) : to > from ? to : to + 1;

    orderedIds.splice(Math.max(0, Math.min(insertAt, orderedIds.length)), 0, moved);
    onReorder(orderedIds);
  };

  return (
    <footer
      className={`relative mx-5 mb-5 flex shrink-0 rounded-[20px] border border-solid border-[color:var(--color-border-3)] bg-white ${
        hasLabeledShot ? "items-start" : "items-center"
      }`}
    >
      {/*
       * 分镜横向滚动，加号跟着分镜排在内容末尾，占满整行宽度即可。
       * 纵向内边距放在滚动容器上：选中态的 6px 外发光和播放三角形都画在
       * item 盒子外面，容器没有留白就会被 overflow 裁掉。
       * 空列表或只有脚本草稿时没有标签/外发光，用对称内边距并纵向居中，
       * 避免 pt/pb 不对称把 78px 卡片顶偏。
       */}
      <div
        className={`min-w-0 flex-1 overflow-x-auto pl-3 pr-3 ${
          hasLabeledShot ? "pb-1 pt-3" : "py-3"
        } ${HIDDEN_SCROLLBAR_CLASS}`}
        ref={scrollRef}
        style={{
          ...HIDDEN_SCROLLBAR_STYLE,
          maskImage,
          WebkitMaskImage: maskImage,
        }}
      >
        <div className={`flex w-max ${hasLabeledShot ? "items-start" : "items-center"}`} ref={contentRef}>
          {shots.map((shot, entryIndex) => {
            const prevIsDraft = Boolean(shots[entryIndex - 1]?.storyboardTaskRunId);
            const isDraft = Boolean(shot.storyboardTaskRunId);
            // 两个脚本草稿之间不插「中间加号」，但仍保留与普通分镜同等的间距。
            const draftSpacer = entryIndex > 0 && isDraft && prevIsDraft;
            const showAddGap = entryIndex > 0 && !draftSpacer;
            return (
              <div className="flex shrink-0 items-start" key={shot.id}>
                {draftSpacer ? <div aria-hidden className="w-3 shrink-0" /> : null}
                {showAddGap ? (
                  <AddShotGap
                    disabled={lockAdd}
                    emphasized={selectedId === shot.id || selectedId === shots[entryIndex - 1]?.id}
                    onAdd={() => {
                      onAdd(entryIndex, "single");
                    }}
                  />
                ) : null}
                {isDraft ? (
                  <div className="shrink-0">
                    <ScriptDraftCard
                      generating={shot.timelineStatus === "generating"}
                      onDismiss={() => onRemove(shot.id)}
                      onOpen={() => onSelect(shot.id)}
                      status={
                        shot.timelineStatus === "pending-confirmation"
                          ? "completed"
                          : shot.timelineStatus === "failed"
                            ? "failed"
                            : "running"
                      }
                    />
                  </div>
                ) : (
                  wrapWithUnsavedPrompt(
                    shot.id,
                    <div
                      className={`shrink-0 ${draggingId === shot.id ? "opacity-50" : ""} ${
                        onReorder ? "cursor-move" : "cursor-not-allowed"
                      } relative`}
                      draggable={!disabled && Boolean(onReorder)}
                      onDragEnd={() => {
                        setDraggingId(undefined);
                        clearInsertPosition();
                      }}
                      onDragOver={(event) => {
                        if (draggingId && draggingId !== shot.id) {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                          setInsertPosition(getInsertSide(shot.id, event));
                        } else {
                          clearInsertPosition();
                        }
                      }}
                      onDragStart={(event) => {
                        setDraggingId(shot.id);
                        clearInsertPosition();
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", shot.id);
                      }}
                      onDragLeave={() => {
                        if (insertPosition?.shotId === shot.id) {
                          clearInsertPosition();
                        }
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const sourceId = draggingId || event.dataTransfer.getData("text/plain");
                        if (!sourceId || sourceId === shot.id || !onReorder) {
                          setDraggingId(undefined);
                          clearInsertPosition();
                          return;
                        }
                        const insertSide =
                          insertPosition?.shotId === shot.id ? insertPosition.side : getInsertSide(shot.id, event).side;

                        handleDrop(sourceId, shot.id, insertSide);
                        setDraggingId(undefined);
                        clearInsertPosition();
                      }}
                    >
                      {insertPosition?.shotId === shot.id && insertPosition.side === "left" ? (
                        <span
                          aria-hidden
                          className="pointer-events-none absolute left-[-6px] top-0 z-[1] h-full w-[3px]"
                          style={{ backgroundColor: "#1664FF" }}
                        />
                      ) : null}
                      <ShotCard
                        deleteDisabledReason={
                          shot.status === "generating" ? t("视频生成中，无法删除") : deleteDisabledReason
                        }
                        disabled={disabled}
                        index={entryIndex}
                        onRemove={onRemove}
                        onSelect={onSelect}
                        playing={playingId === shot.id}
                        selected={selectedId === shot.id}
                        shot={shot}
                      />
                      {insertPosition?.shotId === shot.id && insertPosition.side === "right" ? (
                        <span
                          aria-hidden
                          className="pointer-events-none absolute right-[-6px] top-0 z-[1] h-full w-[3px]"
                          style={{ backgroundColor: "#1664FF" }}
                        />
                      ) : null}
                    </div>,
                  )
                )}
              </div>
            );
          })}
          {/*
           * 溢出后加号浮到右侧，流里换成等尺寸占位：内容宽度保持不变，
           * 否则「挪走加号 → 不再溢出 → 加号挪回来 → 又溢出」会来回抖。
           * 脚本草稿占位期间隐藏新增入口，避免草稿旁再挂一个灰色 +。
           */}
          {adding ? null : overflowing ? (
            <div className="ml-3 h-[78px] w-[78px] shrink-0" />
          ) : (
            <div className={shots.length ? "ml-3 shrink-0" : "shrink-0"}>{addShotButton}</div>
          )}
        </div>
      </div>

      {/*
       * 分镜放得下时加号就跟在最后一个分镜后面，只有真溢出才浮起来贴右侧。
       * 左侧 40px 渐变承接滚动内容的浅出，右侧不透明区把滑到底下的分镜盖住；
       * 渐变区不吃指针事件，免得挡住下面分镜的悬停和点击。
       */}
      {overflowing && !adding ? (
        <div
          className={`pointer-events-none absolute inset-y-0 right-0 flex rounded-r-[20px] pl-10 pr-3 ${
            hasLabeledShot ? "items-start pt-3" : "items-center py-3"
          }`}
          style={{
            background: "linear-gradient(90deg, rgba(255,255,255,0) 0px, #fff 40px)",
          }}
        >
          <div className="pointer-events-auto">{addShotButton}</div>
        </div>
      ) : null}
    </footer>
  );
}
