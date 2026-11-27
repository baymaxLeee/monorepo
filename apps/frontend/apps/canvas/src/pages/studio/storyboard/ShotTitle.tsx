import { Button, Input, toast } from "@repo/design-system";
import { definePrimitive } from "@ui-sdk/core";
import { createParts } from "@ui-sdk/react/primitive";
import { useEffect, useRef, useState } from "react";

import t from "@/utils/i18n";

import { validateCanvasNodeName } from "../domain/canvasNodeNames";
import { shotLabel } from "../domain/model";

import styles from "./ShotTitle.module.css";

type ShotControl = { value: string; disabled: boolean; renameShot: (name: string) => Promise<string> };
const titleState = ({ value, disabled }: ShotControl) => ({ value, disabled });
const titlePrimitive = definePrimitive({
  name: "storyboard-shot",
  options: { value: "string", disabled: "boolean", renameShot: "action" },
  state: titleState,
  sync: titleState,
  agent: { actions: ["rename"] },
  api: ({ options }) => ({
    async rename(name: unknown) {
      const current = options();
      if (current.disabled) throw new Error(t("当前分镜不可编辑"));
      if (typeof name !== "string") throw new Error(t("请输入节点名称"));
      const error = validateCanvasNodeName(name);
      if (error) throw new Error(error);
      return name === current.value ? name : current.renameShot(name);
    },
  }),
  slots: (slot) => ({ root: slot({}) }),
});
const { Root: ShotControlTitle } = createParts(titlePrimitive, { root: "span" });

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

  async function saveName(next: string) {
    setPendingName(next);
    try {
      const saved = await onRename(shotId, next);
      setValue(saved);
      return saved;
    } catch (error) {
      setValue(label);
      throw error;
    } finally {
      setPendingName(undefined);
    }
  }

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
    void saveName(value).catch(() => {
      /* onRename reports the save failure */
    });
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
      className="m-0 h-auto max-w-[200px] shrink-0 truncate p-0 text-xl font-medium leading-7 text-foreground"
      disabled={disabled || pendingName !== undefined}
      onClick={() => {
        setValue(visibleName);
        setEditing(true);
      }}
      title={visibleName}
      variant="ghost"
    >
      <ShotControlTitle
        aria-label={t("当前分镜名称")}
        data-agent-confirm={t("保存当前分镜的新名称")}
        value={label}
        disabled={disabled || pendingName !== undefined}
        renameShot={saveName}
      >
        {visibleName}
      </ShotControlTitle>
    </Button>
  );
}
