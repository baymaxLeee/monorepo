import { MiniMap, type Edge, type ReactFlowInstance, useStore } from "@xyflow/react";
import {
  Hand as IconHand,
  Keyboard as IconKeyboard,
  LayoutDashboard as IconLayout,
  Map as IconMap,
  MousePointer2 as IconCursor,
  Mouse as IconWirelessMouse,
  Plus as IconPlus,
  Scan as IconFit,
} from "lucide-react";
import { useState, type Dispatch, type MouseEvent, type SetStateAction } from "react";

import { Dropdown, Message, Tooltip, Trigger } from "@/components/ui";
import t from "@/utils/i18n";

import type { CanvasFlowNode } from "../graph/canvasNodeTypes";
import {
  type CanvasInteractionMode,
  type ShortcutGroup,
  ARRANGE_CANVAS_SHORTCUT,
  POINTER_SHORTCUT_TOKENS,
} from "./shortcuts";

import styles from "../CanvasBoard.module.less";
const CANVAS_MINIMAP_SIZE = { width: 178, height: 100 };
const CANVAS_MINIMAP_ALIGN = { top: [-72, 12] as [number, number] };
const ZOOM_PRESETS = [0.5, 1, 2, 3, 4] as const;

function CanvasZoomPercent() {
  const zoom = useStore((state) => state.transform[2]);
  return <span>{Math.round(zoom * 100)}%</span>;
}

export function CanvasBoardControls({
  graphLoaded,
  nodeCount,
  canArrange,
  instance,
  interactionMode,
  modeMenuOpen,
  shortcutsOpen,
  setModeMenuOpen,
  setShortcutsOpen,
  onDismissAddMenu,
  arrangeNodes,
  activateInteractionMode,
  openToolbarAddMenu,
}: {
  graphLoaded: boolean;
  nodeCount: number;
  canArrange: boolean;
  instance?: ReactFlowInstance<CanvasFlowNode, Edge>;
  interactionMode: CanvasInteractionMode;
  modeMenuOpen: boolean;
  shortcutsOpen: boolean;
  setModeMenuOpen: Dispatch<SetStateAction<boolean>>;
  setShortcutsOpen: Dispatch<SetStateAction<boolean>>;
  onDismissAddMenu: () => void;
  arrangeNodes: () => Promise<boolean>;
  activateInteractionMode: (mode: CanvasInteractionMode) => void;
  openToolbarAddMenu: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const [miniMapOpen, setMiniMapOpen] = useState(false);
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);

  const isApplePlatform = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const modifierKey = isApplePlatform ? "⌘" : "Ctrl";
  const optionKey = isApplePlatform ? "⌥" : "Alt";
  const arrangeCanvasShortcutKeys = [optionKey, "Shift", ARRANGE_CANVAS_SHORTCUT.key];
  const shortcutGroups: ShortcutGroup[] = [
    {
      title: t("创作"),
      items: [
        { label: t("新建节点"), keys: [t("双击画布")] },
        { label: t("编辑节点"), keys: [t("单击节点")] },
        { label: t("全屏查看"), keys: [t("双击节点")] },
        { label: t("引用素材"), keys: ["@"] },
      ],
    },
    {
      title: t("选择"),
      items: [
        { label: t("单选"), keys: [t("单击")] },
        { label: t("追加多选"), keys: [modifierKey, t("单击")] },
        { label: t("框选多个"), keys: [t("拖动空白画布")] },
        { label: t("删除选中"), keys: ["Backspace / Delete"] },
        { label: t("取消选择"), keys: ["Esc"] },
      ],
    },
    {
      title: t("模式"),
      items: [
        { label: t("移动"), keys: ["V"] },
        { label: t("抓手工具"), keys: ["H"] },
        { label: t("临时抓手"), keys: ["Space", t("拖动")] },
      ],
    },
    {
      title: t("画布"),
      items: [
        { label: t("放大"), keys: [modifierKey, "+"] },
        { label: t("缩小"), keys: [modifierKey, "−"] },
        { label: t("适应画布"), keys: [modifierKey, "0"] },
        { label: t("整理画布"), keys: arrangeCanvasShortcutKeys },
        { label: t("缩放画布"), keys: [modifierKey, t("滚轮")] },
      ],
    },
    {
      title: t("导航"),
      items: [
        { label: t("平移画布"), keys: [t("滚轮 / 双指")] },
        { label: t("聚焦下一个"), keys: ["Tab"] },
        { label: t("聚焦上一个"), keys: ["Shift", "Tab"] },
        { label: t("选中聚焦元素"), keys: ["Enter / Space"] },
      ],
    },
  ];

  return (
    <>
      <div className={styles.canvasMeta}>
        <Tooltip
          content={
            <span className={styles.tooltipContent}>
              {t("整理画布")}
              {arrangeCanvasShortcutKeys.map((key) => (
                <kbd key={key}>{key === "Shift" ? "⇧" : key}</kbd>
              ))}
            </span>
          }
          position="top"
        >
          <button
            aria-label={t("整理画布")}
            disabled={!canArrange}
            onClick={() => {
              onDismissAddMenu();
              setModeMenuOpen(false);
              setShortcutsOpen(false);
              void arrangeNodes().then((success) => {
                if (success) Message.success(t("画布布局已整理"));
              });
            }}
            type="button"
          >
            <IconLayout aria-hidden className={styles.canvasLayoutIcon} strokeWidth={1.5} />
          </button>
        </Tooltip>
        <Tooltip
          content={
            <span className={styles.tooltipContent}>
              {t("适应画布")}
              <kbd>{modifierKey}</kbd>
              <kbd>0</kbd>
            </span>
          }
          position="top"
        >
          <button aria-label={t("适应画布")} onClick={() => instance?.fitView({ duration: 240 })} type="button">
            <IconFit aria-hidden strokeWidth={1.5} />
          </button>
        </Tooltip>
        <Tooltip content={t("画布小地图")} popupVisible={miniMapOpen ? false : undefined} position="top">
          <Trigger
            onVisibleChange={setMiniMapOpen}
            popup={() => (
              <MiniMap
                bgColor="#fff"
                className={styles.miniMap}
                maskColor="rgb(26 27 30 / 5%)"
                nodeBorderRadius={2}
                nodeColor="rgb(160 162 167 / 70%)"
                pannable
                style={CANVAS_MINIMAP_SIZE}
                zoomable
              />
            )}
            popupAlign={CANVAS_MINIMAP_ALIGN}
            popupVisible={miniMapOpen}
            position="tl"
            trigger="click"
          >
            <button
              aria-expanded={miniMapOpen}
              aria-haspopup="dialog"
              aria-label={miniMapOpen ? t("关闭小地图") : t("打开小地图")}
              className={miniMapOpen ? styles.metaButtonActive : undefined}
              type="button"
            >
              <IconMap aria-hidden strokeWidth={1.5} />
            </button>
          </Trigger>
        </Tooltip>
        <Tooltip content={t("缩放选项")} popupVisible={zoomMenuOpen ? false : undefined} position="top">
          <Dropdown
            droplist={
              <div aria-label={t("画布缩放选项")} className={styles.zoomMenu} role="menu">
                <button
                  onClick={() => {
                    setZoomMenuOpen(false);
                    void instance?.zoomIn({ duration: 160 });
                  }}
                  role="menuitem"
                  type="button"
                >
                  <span>{t("放大")}</span>
                  <span className={styles.zoomShortcut}>
                    <kbd>{modifierKey}</kbd>
                    <kbd>+</kbd>
                  </span>
                </button>
                <button
                  onClick={() => {
                    setZoomMenuOpen(false);
                    void instance?.zoomOut({ duration: 160 });
                  }}
                  role="menuitem"
                  type="button"
                >
                  <span>{t("缩小")}</span>
                  <span className={styles.zoomShortcut}>
                    <kbd>{modifierKey}</kbd>
                    <kbd>−</kbd>
                  </span>
                </button>
                <button
                  onClick={() => {
                    setZoomMenuOpen(false);
                    void instance?.fitView({ duration: 240 });
                  }}
                  role="menuitem"
                  type="button"
                >
                  <span>{t("适应画布")}</span>
                  <span className={styles.zoomShortcut}>
                    <kbd>{modifierKey}</kbd>
                    <kbd>0</kbd>
                  </span>
                </button>
                <span className={styles.zoomMenuDivider} />
                {ZOOM_PRESETS.map((zoom) => (
                  <button
                    key={zoom}
                    onClick={() => {
                      setZoomMenuOpen(false);
                      void instance?.zoomTo(zoom, { duration: 240 });
                    }}
                    role="menuitem"
                    type="button"
                  >
                    {zoom * 100}%
                  </button>
                ))}
              </div>
            }
            onVisibleChange={setZoomMenuOpen}
            popupVisible={zoomMenuOpen}
            position="top"
            trigger="click"
            triggerProps={{ popupAlign: { top: 12 } }}
          >
            <button
              aria-expanded={zoomMenuOpen}
              aria-haspopup="menu"
              aria-label={t("画布缩放比例")}
              className={`${styles.zoomPercent} ${zoomMenuOpen ? styles.metaButtonActive : ""}`}
              type="button"
            >
              <CanvasZoomPercent />
            </button>
          </Dropdown>
        </Tooltip>
      </div>

      {graphLoaded && nodeCount === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>
            <span className={styles.emptyTitlePrimary}>
              <IconCursor />
              <strong>{t("双击画布")}</strong>
            </span>
            <span className={styles.emptyTitleSecondary}>{t("自由生成节点")}</span>
          </div>
          <div className={styles.emptyHints}>
            <span>
              {t("按住")}
              <kbd>Space</kbd>
              {t("可以拖拽画布")}
            </span>
            <span>
              {t("滚动")}
              <IconWirelessMouse />
              {t("缩放画布")}
            </span>
          </div>
        </div>
      ) : null}

      <div
        className={`${styles.toolbar} ${shortcutsOpen ? styles.toolbarRaised : ""}`}
        onClick={(event) => event.stopPropagation()}
      >
        <Tooltip content={t("添加节点")} position="top">
          <button
            aria-label={t("添加节点")}
            className={styles.addToolButton}
            onClick={openToolbarAddMenu}
            type="button"
          >
            <IconPlus aria-hidden strokeWidth={1.5} />
          </button>
        </Tooltip>
        <Tooltip content={interactionMode === "select" ? t("移动") : t("抓手工具")} position="top">
          <button
            aria-expanded={modeMenuOpen}
            aria-haspopup="menu"
            aria-label={interactionMode === "select" ? t("移动") : t("抓手工具")}
            className={`${styles.toolButton} ${
              modeMenuOpen || interactionMode === "hand" ? styles.toolButtonActive : ""
            }`}
            onClick={() => {
              onDismissAddMenu();
              setShortcutsOpen(false);
              setModeMenuOpen((open) => !open);
            }}
            type="button"
          >
            {interactionMode === "select" ? (
              <IconCursor aria-hidden strokeWidth={1.5} />
            ) : (
              <IconHand aria-hidden strokeWidth={1.5} />
            )}
          </button>
        </Tooltip>
        {modeMenuOpen ? (
          <div className={styles.modeMenu} role="menu">
            <button
              aria-checked={interactionMode === "select"}
              className={interactionMode === "select" ? styles.modeMenuActive : ""}
              onClick={() => activateInteractionMode("select")}
              role="menuitemradio"
              type="button"
            >
              <span>
                <IconCursor aria-hidden strokeWidth={1.5} />
                {t("移动")}
              </span>
              <kbd>V</kbd>
            </button>
            <button
              aria-checked={interactionMode === "hand"}
              className={interactionMode === "hand" ? styles.modeMenuActive : ""}
              onClick={() => activateInteractionMode("hand")}
              role="menuitemradio"
              type="button"
            >
              <span>
                <IconHand aria-hidden strokeWidth={1.5} />
                {t("抓手工具")}
              </span>
              <kbd>H</kbd>
            </button>
          </div>
        ) : null}
        <span className={styles.toolDivider} />
        <Tooltip content={t("快捷键")} position="top">
          <button
            aria-label={t("快捷键")}
            aria-pressed={shortcutsOpen}
            className={`${styles.toolButton} ${shortcutsOpen ? styles.toolButtonActive : ""}`}
            onClick={() => {
              onDismissAddMenu();
              setModeMenuOpen(false);
              setShortcutsOpen((open) => !open);
            }}
            type="button"
          >
            <IconKeyboard aria-hidden strokeWidth={1.5} />
          </button>
        </Tooltip>
      </div>

      <aside
        aria-hidden={!shortcutsOpen}
        aria-label={t("画布快捷键")}
        className={`${styles.shortcutDrawer} ${shortcutsOpen ? styles.shortcutDrawerOpen : ""}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.shortcutGroups}>
          {shortcutGroups.map((group) => (
            <section className={styles.shortcutGroup} key={group.title}>
              <h3>{t(group.title)}</h3>
              {group.items.map((item) => (
                <div className={styles.shortcutRow} key={item.label}>
                  <span>{t(item.label)}</span>
                  <span className={styles.shortcutKeys}>
                    {item.keys.map((key, index) => (
                      <span key={`${item.label}-${key}`}>
                        {index > 0 ? <span className={styles.shortcutJoin}>+</span> : null}
                        {POINTER_SHORTCUT_TOKENS.has(key) ? (
                          <span className={styles.shortcutGesture}>{t(key)}</span>
                        ) : (
                          <kbd>{t(key)}</kbd>
                        )}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </aside>
    </>
  );
}
