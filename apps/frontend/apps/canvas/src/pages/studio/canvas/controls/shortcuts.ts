import t from "@/utils/i18n";

export type CanvasInteractionMode = "select" | "hand";

export type ShortcutItem = {
  keys: string[];
  label: string;
};

export type ShortcutGroup = {
  items: ShortcutItem[];
  title: string;
};

export const POINTER_SHORTCUT_TOKENS = new Set([
  t("双击画布"),
  t("双击节点"),
  t("单击"),
  t("拖动空白画布"),
  t("拖动"),
  t("滚轮"),
  t("滚轮 / 双指"),
]);

export const ARRANGE_CANVAS_SHORTCUT = {
  code: "KeyF",
  key: "F",
  modifiers: {
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    shiftKey: true,
  },
} as const;
