import {
  forwardRef,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { cn } from "shared";

export interface SuggestionListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export interface SuggestionOption {
  key: string;
  content: ReactNode;
}

export interface SuggestionListProps {
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
export const SuggestionList = forwardRef<
  SuggestionListHandle,
  SuggestionListProps
>(function SuggestionList({ options, loading, emptyLabel, onPick }, ref) {
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => setActive(0), [options]);

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown: ({ event }) => {
        if (options.length === 0) return false;
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
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (options.length === 0) {
    return (
      <div className="prompt-input-suggestion">
        <div className="prompt-input-suggestion-empty">
          {loading ? "搜索中…" : (emptyLabel ?? "无匹配项")}
        </div>
      </div>
    );
  }

  return (
    <div ref={listRef} className="prompt-input-suggestion" role="listbox">
      {options.map((option, index) => {
        const isActive = index === active;
        return (
          <button
            key={option.key}
            type="button"
            role="option"
            aria-selected={isActive}
            data-active={isActive}
            className={cn(
              "prompt-input-suggestion-item",
              isActive && "is-active",
            )}
            onMouseEnter={() => setActive(index)}
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(index);
            }}
          >
            {option.content}
          </button>
        );
      })}
    </div>
  );
});
