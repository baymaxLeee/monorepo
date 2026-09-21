import { useEffect, useRef, useState } from "react";

import { EllipsisText as CEllipsis } from "@/components/compat";
import { Input, Message } from "@/components/ui";
import t from "@/utils/i18n";

import { validateCanvasNodeName } from "../domain/canvasNodeNames";
import { shotLabel } from "../domain/model";

import styles from "./ShotTitle.module.less";

export function ShotTitle({
  disabled = false,
  index,
  name,
  onRename,
  shotId,
}: {
  disabled?: boolean;
  index: number;
  name?: string;
  onRename: (id: string, name: string) => Promise<string>;
  shotId: string;
}) {
  const label = name || shotLabel(index);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(label);
  const [pendingName, setPendingName] = useState<string>();
  const cancelRef = useRef(false);

  useEffect(() => {
    if (pendingName === label) setPendingName(undefined);
    if (!editing && pendingName === undefined) setValue(label);
  }, [editing, label, pendingName]);

  const finish = () => {
    if (cancelRef.current) {
      cancelRef.current = false;
      setValue(label);
      setEditing(false);
      return;
    }
    const validationMessage = validateCanvasNodeName(value);
    if (validationMessage) {
      Message.error(validationMessage);
      setValue(label);
      setEditing(false);
      return;
    }
    setEditing(false);
    if (value === label) return;
    setPendingName(value);
    void onRename(shotId, value).then(
      (savedName) => {
        setPendingName(undefined);
        setValue(savedName);
      },
      () => {
        setPendingName(undefined);
        setValue(label);
      },
    );
  };

  if (editing) {
    return (
      <Input
        aria-label={t("分镜名称")}

        className={styles.input}
        onBlur={finish}
        onChange={setValue}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            cancelRef.current = true;
            event.currentTarget.blur();
          }
        }}
        size="mini"
        value={value}
      />
    );
  }

  const visibleName = pendingName ?? label;
  return (
    <CEllipsis
      className="m-0 shrink-0 truncate text-[20px] font-medium leading-7 text-[color:var(--color-text-1)] cursor-text"
      maxWidth={200}
      onClick={
        disabled
          ? undefined
          : () => {
              setValue(visibleName);
              setEditing(true);
            }
      }
      useCursorPointer={false}
    >
      {visibleName}
    </CEllipsis>
  );
}
