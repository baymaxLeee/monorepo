import { cn } from "shared";
import { useState } from "react";
import { slotClassNameFactory } from "../../../compat/className";

interface TableSelectorProps {
  onSelect: (rows: number, cols: number) => void;
  className?: string;
}

const cssPrefix = slotClassNameFactory("markdown-editor-table-selector");

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
    <div className={cn(cssPrefix`root`, className)}>
      <div className={cssPrefix`title`}>
        <span>插入表格</span>
        <span>{hoverRow > 0 ? `${hoverRow} x ${hoverCol}` : ""}</span>
      </div>
      <div
        className={cssPrefix`grid`}
        style={{ gridTemplateColumns: `repeat(${MAX_COLS}, 1fr)` }}
        onMouseLeave={handleMouseLeave}
      >
        {grid.map(({ row, col }) => {
          const isActive = row <= hoverRow && col <= hoverCol;

          return (
            <div
              key={`${row}-${col}`}
              className={cn(
                cssPrefix`cell`,
                isActive && cssPrefix`cell-active`,
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
