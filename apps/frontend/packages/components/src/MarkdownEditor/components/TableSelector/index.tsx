import { useState } from "react";
import { cn } from "shared";

interface TableSelectorProps {
  onSelect: (rows: number, cols: number) => void;
  className?: string;
}

const MAX_ROWS = 9;
const MAX_COLS = 9;

export const TableSelector = ({ onSelect, className }: TableSelectorProps) => {
  const [hoverRow, setHoverRow] = useState(0);
  const [hoverCol, setHoverCol] = useState(0);

  const handleMouseMove = (row: number, col: number) => {
    setHoverRow(row);
    setHoverCol(col);
  };

  const handleMouseLeave = () => {
    setHoverRow(0);
    setHoverCol(0);
  };

  const handleClick = () => {
    if (hoverRow > 0 && hoverCol > 0) {
      onSelect(hoverRow, hoverCol);
    }
  };

  const grid: Array<{ row: number; col: number }> = [];
  for (let row = 1; row <= MAX_ROWS; row++) {
    for (let col = 1; col <= MAX_COLS; col++) {
      grid.push({ row, col });
    }
  }

  return (
    <div
      className={cn(
        "min-w-[200px] rounded-lg border bg-popover p-2 shadow-md",
        className,
      )}
    >
      <div className="mb-2 flex items-center justify-between px-1 text-xs font-medium text-muted-foreground">
        <span>插入表格</span>
        <span>{hoverRow > 0 ? `${hoverRow} x ${hoverCol}` : ""}</span>
      </div>
      <div
        className="grid select-none gap-1 px-1"
        style={{ gridTemplateColumns: `repeat(${MAX_COLS}, 1fr)` }}
        onMouseLeave={handleMouseLeave}
      >
        {grid.map(({ row, col }) => {
          const isActive = row <= hoverRow && col <= hoverCol;

          return (
            <div
              key={`${row}-${col}`}
              className={cn(
                "relative size-4 cursor-pointer rounded-[2px] border bg-background transition-all hover:z-10 hover:scale-110 hover:border-blue-500",
                isActive &&
                  "border-blue-500 bg-blue-100 shadow-[0_0_0_1px_var(--color-blue-200)]",
              )}
              onMouseEnter={() => handleMouseMove(row, col)}
              onClick={handleClick}
            />
          );
        })}
      </div>
    </div>
  );
};
