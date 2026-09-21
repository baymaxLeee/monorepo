import type { ReactNode } from "react";

/**
 * 分段控件的轨道容器。选项自绘的场景（例如带示意图形的磁贴）直接用它加
 * segmentItemClass 组装，避免为了塞自定义内容给 Segmented 开渲染钩子。
 */
export function SegmentedTrack({ children }: { children: ReactNode }) {
  return <div className="flex items-stretch gap-0 rounded-[8px] bg-[rgba(26,27,30,0.05)] p-1">{children}</div>;
}

export function segmentItemClass(selected: boolean) {
  return `flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-[6px] border-0 p-0 text-[13px] font-medium leading-5.5 transition-colors ${
    selected
      ? "bg-white text-foreground shadow-[0px_1px_3px_0px_rgba(0,0,0,0.08)]"
      : "bg-[transparent] text-foreground hover:text-foreground"
  }`;
}

/** 纯文本选项的分段控件。 */
export function Segmented({
  getOptionLabel = (option) => option,
  options,
  value,
  onChange,
}: {
  getOptionLabel?: (option: string) => string;
  options: string[];
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <SegmentedTrack>
      {options.map((option) => (
        <button
          className={`${segmentItemClass(option === value)} h-6`}
          key={option}
          onClick={() => onChange(option)}
          type="button"
        >
          {getOptionLabel(option)}
        </button>
      ))}
    </SegmentedTrack>
  );
}
