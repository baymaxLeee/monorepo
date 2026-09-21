import { Proportions } from "lucide-react";

/** 设计稿中普通字重表示未选中态，500 字重表示选中态。 */
export function RatioIcon({ ratio, selected = false }: { ratio: string; selected?: boolean }) {
  const [horizontal, vertical] = ratio.split(":").map(Number);
  if (!horizontal || !vertical) return <Proportions aria-hidden size={14} />;
  const scale = 18 / Math.max(horizontal, vertical);
  const width = horizontal * scale;
  const height = vertical * scale;
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" className="shrink-0">
      <rect
        x={(24 - width) / 2}
        y={(24 - height) / 2}
        width={width}
        height={height}
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth={selected ? 2.5 : 1.5}
      />
    </svg>
  );
}
