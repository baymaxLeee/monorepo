import { Button, Input, toast } from "@repo/design-system";
import { useEffect, useRef, useState } from "react";

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
      toast.add({
        type: "error",
        title: validationMessage,
      });
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
        onChange={(event) => setValue(event.currentTarget.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            cancelRef.current = true;
            event.currentTarget.blur();
          }
        }}
        value={value}
      />
    );
  }

  const visibleName = pendingName ?? label;
  return (
    <Button
      aria-label={t("编辑分镜名称：{name}", { name: visibleName })}
      className="m-0 h-auto max-w-[200px] shrink-0 truncate p-0 text-[20px] font-medium leading-7 text-foreground"
      disabled={disabled}
      onClick={() => {
        setValue(visibleName);
        setEditing(true);
      }}
      title={visibleName}
      variant="ghost"
    >
      {visibleName}
    </Button>
  );
}
