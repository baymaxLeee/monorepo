import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * 触发方式（参考 Arco `Trigger.trigger`）。
 * 目前 `DropdownMenu` / `Popover` 支持 `"click"`（默认） 与 `"hover"`。
 * 后续如果需要 `"focus" | "contextMenu"` 再扩展。
 */
export type TriggerKind = "click" | "hover";

export interface HoverTriggerHandlers {
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export interface UseHoverTriggerOptions {
  /** 触发方式；非 "hover" 时返回的 handlers 为 no-op，open 完全交给上层。 */
  trigger?: TriggerKind;
  /** 受控 open，未传入则内部维护。 */
  open?: boolean;
  /** 默认 open，仅在非受控且 trigger==="hover" 时生效。 */
  defaultOpen?: boolean;
  /** open 状态变化回调（含 click 与 hover 两种来源）。 */
  onOpenChange?: (open: boolean) => void;
  /**
   * 鼠标进入 trigger / content 多久后打开（毫秒），默认 80。
   * 用于过滤"鼠标横扫工具栏"这种快速穿过 trigger 引起的闪烁。
   */
  hoverEnterDelay?: number;
  /**
   * 鼠标移出 trigger / content 多久后关闭（毫秒），默认 200。
   * 默认 200 是为了让鼠标在 trigger 与 content 之间的 sideOffset 死区
   * 慢速穿越时不会误触发关闭。
   */
  hoverCloseDelay?: number;
}

export interface UseHoverTriggerResult {
  /** 当前 open 状态（hover 模式由本 hook 管理；click 模式回传 props.open）。 */
  open: boolean | undefined;
  /** open 状态写入器；hover 模式下会同时同步上层 onOpenChange。 */
  setOpen: (next: boolean) => void;
  /** 绑定到 trigger / content 的鼠标事件，hover 之外为 no-op。 */
  handlers: HoverTriggerHandlers;
  /** 是否启用 hover 行为。 */
  enabled: boolean;
}

/**
 * 通用 "hover 触发" 状态机，供 DropdownMenu / Popover 等 wrapper 内部使用。
 *
 * 设计原则：
 * - hover 模式下：鼠标在 trigger 或 content 内停留 `hoverEnterDelay` 后打开；
 *   离开后 `hoverCloseDelay` 内若未重新进入再关闭。Trigger / Content 共用
 *   同一份事件，鼠标横跨缝隙时通过 `insideRef` 感知"仍在范围内"避免闪烁。
 * - 状态机有两层兜底：
 *   1) 进入 / 离开都用 `insideRef` 维护"是否仍在范围内"，timer 触发前再校验；
 *   2) 同方向的 timer 不重复 schedule，避免重复事件创建多枚 timer 互相覆盖。
 * - click 模式下：本 hook 完全旁路，handlers 为 no-op，open 直接透传上层。
 * - 始终透传 onOpenChange，让外部可以观察任意来源（含 Radix click toggle）的开合。
 */
export function useHoverTrigger({
  trigger = "click",
  open: controlledOpen,
  defaultOpen,
  onOpenChange,
  hoverEnterDelay = 80,
  hoverCloseDelay = 200,
}: UseHoverTriggerOptions): UseHoverTriggerResult {
  const enabled = trigger === "hover";
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState<boolean>(
    defaultOpen ?? false,
  );

  const open = enabled
    ? isControlled
      ? controlledOpen
      : internalOpen
    : controlledOpen;

  // 当前鼠标是否在 trigger 或 content 内的范围里。
  // 因为 trigger 和 content 各有 enter/leave，跨缝隙时会先 leave 再 enter，
  // insideRef 让 timer fire 前知道"用户实际还在范围内"，避免误关闭。
  const insideRef = useRef(false);
  // 当前实际 open 的最新值，timer 内同步用，避免闭包拿到旧 open。
  const openRef = useRef<boolean | undefined>(open);
  useEffect(() => {
    openRef.current = open;
  });

  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelOpen = () => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  };
  const cancelClose = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  useEffect(
    () => () => {
      cancelOpen();
      cancelClose();
    },
    [],
  );

  const setOpen = useCallback(
    (next: boolean) => {
      if (enabled && !isControlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [enabled, isControlled, onOpenChange],
  );

  const handlers = useMemo<HoverTriggerHandlers>(() => {
    if (!enabled) {
      return { onMouseEnter: () => {}, onMouseLeave: () => {} };
    }
    return {
      onMouseEnter: () => {
        insideRef.current = true;
        cancelClose();
        // 已经处于 open 或正在 open 的途中，不重复 schedule
        if (openRef.current === true) return;
        if (openTimerRef.current) return;
        openTimerRef.current = setTimeout(() => {
          openTimerRef.current = null;
          // 二次校验：timer fire 时鼠标还在范围内才真正打开
          if (insideRef.current) setOpen(true);
        }, hoverEnterDelay);
      },
      onMouseLeave: () => {
        insideRef.current = false;
        cancelOpen();
        // 已经处于 closed 或正在 close 的途中，不重复 schedule
        if (openRef.current === false) return;
        if (closeTimerRef.current) return;
        closeTimerRef.current = setTimeout(() => {
          closeTimerRef.current = null;
          // 二次校验：timer fire 时鼠标已离开才真正关闭
          if (!insideRef.current) setOpen(false);
        }, hoverCloseDelay);
      },
    };
  }, [enabled, hoverEnterDelay, hoverCloseDelay, setOpen]);

  return { open, setOpen, handlers, enabled };
}
