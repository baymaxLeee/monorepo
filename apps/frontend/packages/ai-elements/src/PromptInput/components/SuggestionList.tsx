import { cn } from "@repo/shared";
import { forwardRef, type ReactNode, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface SuggestionListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export interface SuggestionOption {
  key: string;
  content: ReactNode;
}

export interface SuggestionListProps {
  id?: string;
  onActiveChange?: (id: string | null) => void;
  options: SuggestionOption[];
  loading?: boolean;
  emptyLabel?: string;
  onPick: (index: number) => void;
}

/**
 * Generic-free, keyboard-driven suggestion list. Callers pre-render each item to
 * `{ key, content }`, so this stays a plain forwardRef component (typed item
 * shapes live in the extension wrapper). Exposes `onKeyDown` for the suggestion
 * plugin to forward arrow/enter handling into.
 */
export const SuggestionList = forwardRef<SuggestionListHandle, SuggestionListProps>(function SuggestionList(
  { options, loading, emptyLabel, onPick, id, onActiveChange },
  ref,
) {
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => setActive(0), [options]);

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown: ({ event }) => {
        if (options.length === 0) {
          return false;
        }
        if (event.key === "ArrowUp") {
          setActive((index) => (index - 1 + options.length) % options.length);
          return true;
        }
        if (event.key === "ArrowDown") {
          setActive((index) => (index + 1) % options.length);
          return true;
        }
        if (event.key === "Enter") {
          onPick(active);
          return true;
        }
        return false;
      },
    }),
    [options, active, onPick],
  );

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
    onActiveChange?.(options[active] && id ? `${id}-${active}` : null);
  }, [active, id, options, onActiveChange]);

  if (options.length === 0) {
    return (
      <div id={id} className="prompt-input-suggestion" role="status" aria-live="polite">
        <div className="prompt-input-suggestion-empty">{loading ? "搜索中…" : (emptyLabel ?? "无匹配项")}</div>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      id={id}
      className="prompt-input-suggestion"
      role="listbox"
      aria-label="输入建议"
      aria-busy={loading}
    >
      {options.map((option, index) => {
        const isActive = index === active;
        return (
          <button
            key={option.key}
            id={id ? `${id}-${index}` : undefined}
            tabIndex={-1}
            type="button"
            role="option"
            aria-selected={isActive}
            data-active={isActive}
            className={cn("prompt-input-suggestion-item", isActive && "is-active")}
            onMouseEnter={() => setActive(index)}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => onPick(index)}
          >
            {option.content}
          </button>
        );
      })}
    </div>
  );
});
