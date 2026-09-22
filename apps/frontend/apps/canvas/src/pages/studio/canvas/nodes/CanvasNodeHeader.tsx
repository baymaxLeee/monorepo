import { Music as IconMusic } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AssetReviewMark } from "@/components/promptEditor/plugins/assetMention/ReviewStatus";
import { Input, Message, Tooltip } from "@/components/ui";
import { canvasnode } from "@/domain";
import t from "@/utils/i18n";

import { validateCanvasNodeName } from "../../domain/canvasNodeNames";
import type { StoryboardAsset } from "../../domain/types";
import { isDeletedReferenceNode } from "../graph/canvasNodeHelpers";
import type { CanvasNodeData } from "../graph/canvasNodeTypes";
import { canvasNodeProtocol } from "../graph/nodeProtocol";

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
      Message.error(validationMessage);
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
      <Tooltip content={item.Name} position="top">
        <span className={styles.nodeTitle}>{item.Name}</span>
      </Tooltip>
    );
  }
  if (editing) {
    return (
      <Input
        className={`${styles.nodeNameInput} nodrag nopan`}
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
        onPointerDown={(event) => event.stopPropagation()}
        size="mini"
        value={value}
      />
    );
  }
  return (
    <div className={styles.nodeTitleGroup}>
      <Tooltip content={item.Name} position="top">
        <button
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
        </button>
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
          <IconMusic className={styles.nodeKind} />
        ) : (
          <img alt="" className={styles.nodeKind} src={canvasNodeProtocol(item.Type).placeholderIcon} />
        )}
        <CanvasNodeName item={item} onPatch={onPatch} reviewAsset={reviewAsset} />
      </div>
    </div>
  );
}
