import { Input, toast, Tooltip, TooltipContent, TooltipTrigger, Button } from "@repo/design-system";
import { Music as IconMusic } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AssetReviewMark } from "@/components/promptEditor/plugins/assetMention/ReviewStatus";
import { canvasnode } from "@/domain";
import t from "@/utils/i18n";

import { validateCanvasNodeName } from "../../domain/canvasNodeNames";
import type { StoryboardAsset } from "../../domain/types";
import { CanvasNodeIcon } from "../components/CanvasNodeIcon";
import { isDeletedReferenceNode } from "../graph/canvasNodeHelpers";
import type { CanvasNodeData } from "../graph/canvasNodeTypes";

import styles from "../CanvasBoard.module.less";
export function CanvasNodeName({
  item,
  onPatch,
  reviewAsset,
}: {
  item: canvasnode.CanvasNode;
  onPatch: CanvasNodeData["onPatch"];
  reviewAsset?: StoryboardAsset;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(item.Name);
  const [pendingName, setPendingName] = useState<string>();
  const cancelRef = useRef(false);

  useEffect(() => {
    if (pendingName === item.Name) setPendingName(undefined);
    if (!editing && pendingName === undefined) setValue(item.Name);
  }, [editing, item.Name, pendingName]);

  const finish = () => {
    if (cancelRef.current) {
      cancelRef.current = false;
      setValue(item.Name);
      setEditing(false);
      return;
    }
    const validationMessage = validateCanvasNodeName(value);
    if (validationMessage) {
      toast.add({
        type: "error",
        title: validationMessage,
      });
      setValue(item.Name);
      setEditing(false);
      return;
    }
    setEditing(false);
    if (value !== item.Name) {
      setPendingName(value);
      void onPatch(item, { Name: value }).then(
        (updated) => {
          setPendingName(undefined);
          setValue(updated.Name);
        },
        () => {
          setPendingName(undefined);
          setValue(item.Name);
        },
      );
    }
  };

  if (isDeletedReferenceNode(item) || item.Type === canvasnode.CanvasNodeType.STORYBOARD_DRAFT) {
    return (
      <Tooltip>
        <TooltipTrigger render={<span className={styles.nodeTitle}>{item.Name}</span>} />
        <TooltipContent side={"top"}>{item.Name}</TooltipContent>
      </Tooltip>
    );
  }
  if (editing) {
    return (
      <Input
        aria-label={t("节点名称")}
        autoFocus
        className={`${styles.nodeNameInput} nodrag nopan`}
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
        onPointerDown={(event) => event.stopPropagation()}
        value={value}
      />
    );
  }
  return (
    <div className={styles.nodeTitleGroup}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              aria-label={t("编辑节点名称：{name}", { name: item.Name })}
              className={`${styles.nodeTitle} ${styles.nodeTitleButton} nodrag nopan`}
              onClick={(event) => {
                event.stopPropagation();
                setEditing(true);
              }}
              onPointerDown={(event) => event.stopPropagation()}
              type="button"
            >
              {pendingName ?? item.Name}
            </Button>
          }
        />
        <TooltipContent side={"top"}>{item.Name}</TooltipContent>
      </Tooltip>
      {reviewAsset ? <AssetReviewMark asset={reviewAsset} showDetails /> : null}
    </div>
  );
}

export function CanvasNodeHeader({
  item,
  onPatch,
  reviewAsset,
}: {
  item: canvasnode.CanvasNode;
  onPatch: CanvasNodeData["onPatch"];
  reviewAsset?: StoryboardAsset;
}) {
  return (
    <div className={`${styles.nodeHeader} canvas-node-drag-handle`}>
      <div
        className={styles.nodeHeaderContent}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {item.Type === canvasnode.CanvasNodeType.AUDIO_ASSET ? (
          <IconMusic aria-hidden className={styles.nodeKind} strokeWidth={1.5} />
        ) : (
          <CanvasNodeIcon aria-hidden className={styles.nodeKind} nodeType={item.Type} strokeWidth={1.5} />
        )}
        <CanvasNodeName item={item} onPatch={onPatch} reviewAsset={reviewAsset} />
      </div>
    </div>
  );
}
