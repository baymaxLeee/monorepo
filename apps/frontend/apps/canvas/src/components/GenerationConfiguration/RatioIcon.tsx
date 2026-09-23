import { RectangleHorizontal, RectangleVertical, Square } from "lucide-react";

/** 设计稿中普通字重表示未选中态，500 字重表示选中态。 */
export function RatioIcon({ ratio, selected = false }: { ratio: string; selected?: boolean }) {
  const [horizontal, vertical] = ratio.split(":").map(Number);
  const Icon = horizontal === vertical ? Square : horizontal > vertical ? RectangleHorizontal : RectangleVertical;
  return <Icon aria-hidden className="shrink-0" size={14} strokeWidth={selected ? 2.5 : 1.5} />;
}
