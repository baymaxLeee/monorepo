/**
 * 兼容入口：旧实现里 Table 三个 BubbleMenu 共享的 MenuItem 包装。
 * 现在直接复用 components 包的通用 Menu 体系，避免重复封装。
 */
export { MenuItem } from "../../../../Menu";

/** Stable reference — avoids BubbleMenu re-renders caused by inline arrow functions */
export const ALWAYS_SHOW = () => true;
