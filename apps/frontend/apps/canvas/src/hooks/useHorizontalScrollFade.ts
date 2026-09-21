import { type CSSProperties, useEffect, useState } from "react";

/**
 * Firefox 的物理滚轮按「行」计量，一格只报 deltaY≈3，直接当像素加等于滚不动。
 * 取 40px/行是沿用 normalize-wheel 的经验值，换算后每格约 120px，和 Chromium
 * 的像素步进落在同一量级。
 */
const LINE_HEIGHT_PX = 40;

/**
 * 藏掉轨道，只靠两端渐隐提示「还有内容」，横向滚动统一走这套。
 *
 * 拆成 class 和内联样式两份：WebKit 认伪元素、Firefox 只认 scrollbar-width，
 * 而后者当前的 Tailwind 配置不生成任意属性类，只能落到 style 上。
 */
export const HIDDEN_SCROLLBAR_CLASS = "[&::-webkit-scrollbar]:hidden";

export const HIDDEN_SCROLLBAR_STYLE: CSSProperties = { scrollbarWidth: "none" };

/**
 * 横向滚动条：把纵向滚轮映射成横向滚动，并按当前位置在两端做浅入浅出。
 *
 * 只给「那一侧确实还有内容被裁掉」的一端加渐隐，两端都到底时蒙版是全不透明的，
 * 不会平白削掉首尾元素。把 scrollRef 挂在滚动容器上、contentRef 挂在内层内容上，
 * 内容宽度变化不会改变容器尺寸，两边都观察才能及时重算可滚动范围。
 *
 * 两个 ref 都是回调 ref：调用方常把滚动容器挂在「数据到了才渲染」的分支里，
 * 用 useRef 的话首帧拿到的是 null，effect 空跑一次就再也不会重来，
 * 表现为监听没挂上、蒙版恒不透明，只剩容器硬裁。
 *
 * 额外抛出 overflowing，给「内容放得下就随内容排、放不下才浮起来」的常驻操作用。
 */
export function useHorizontalScrollFade(fadeWidth = 40) {
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({
    end: false,
    overflowing: false,
    start: false,
  });

  useEffect(() => {
    if (!viewport || !content) {
      return;
    }

    const syncEdges = () => {
      const max = viewport.scrollWidth - viewport.clientWidth;
      setEdges({
        end: viewport.scrollLeft < max - 1,
        overflowing: max > 1,
        start: viewport.scrollLeft > 1,
      });
    };
    /** deltaY 的单位由 deltaMode 决定，统一换算成像素再喂给 scrollLeft。 */
    const deltaYInPixels = (event: WheelEvent) => {
      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
        return event.deltaY * LINE_HEIGHT_PX;
      }
      // 横向滚动的「一页」就是视口宽度。
      if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
        return event.deltaY * viewport.clientWidth;
      }
      return event.deltaY;
    };
    /** React 把 wheel 注册成被动监听，preventDefault 会失效，只能自己挂原生监听。 */
    const scrollHorizontally = (event: WheelEvent) => {
      if (viewport.scrollWidth <= viewport.clientWidth) {
        return;
      }
      // 触控板的横向分量本来就能滚，这里只把纵向滚轮映射过来。
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
        return;
      }
      viewport.scrollLeft += deltaYInPixels(event);
      event.preventDefault();
    };

    syncEdges();
    const observer = new ResizeObserver(syncEdges);
    observer.observe(viewport);
    observer.observe(content);
    viewport.addEventListener("scroll", syncEdges);
    viewport.addEventListener("wheel", scrollHorizontally, { passive: false });

    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", syncEdges);
      viewport.removeEventListener("wheel", scrollHorizontally);
    };
  }, [content, viewport]);

  const maskImage = `linear-gradient(90deg, ${
    edges.start ? "transparent" : "#000"
  } 0px, #000 ${fadeWidth}px, #000 calc(100% - ${fadeWidth}px), ${edges.end ? "transparent" : "#000"} 100%)`;

  return {
    contentRef: setContent,
    maskImage,
    overflowing: edges.overflowing,
    scrollRef: setViewport,
  };
}
