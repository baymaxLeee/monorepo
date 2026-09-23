import { Handle, Position } from "@xyflow/react";
import { Plus } from "lucide-react";
import { useContext } from "react";

import type { canvasnode } from "@/domain";
import t from "@/utils/i18n";

import { CanvasQuickCreateContext } from "../CanvasNodeContexts";
import { isDeletedReferenceNode } from "../graph/canvasNodeHelpers";
import { type CanvasNodePortSide, canvasNodeInputPorts, canvasNodeProtocol } from "../graph/nodeProtocol";

import styles from "../CanvasBoard.module.less";
export function CanvasNodePort({ item, side }: { item: canvasnode.CanvasNode; side: CanvasNodePortSide }) {
  const quickCreate = useContext(CanvasQuickCreateContext);
  const protocol = canvasNodeProtocol(item.Type);
  const deleted = isDeletedReferenceNode(item);
  const inputLocked = side === "input" && Boolean(item.ActiveTaskRunID);
  const interactive =
    !deleted && !inputLocked && (side === "output" || canvasNodeInputPorts(item, "connection").length > 0);
  if (side === "input" && protocol.inputs.material.length === 0) {
    return null;
  }
  return (
    <Handle
      aria-label={side === "input" ? t("添加上游节点") : t("添加下游节点")}
      aria-disabled={!interactive}
      className={`${styles.handle} ${
        interactive ? "" : deleted || inputLocked ? styles.disabledHandle : styles.hiddenHandle
      } nodrag`}
      id={side}
      onClick={(event) => {
        event.stopPropagation();
        if (!interactive) return;
        quickCreate.open(item, side, event);
      }}
      isConnectable={interactive}
      isConnectableEnd={interactive}
      isConnectableStart={interactive}
      position={side === "input" ? Position.Left : Position.Right}
      title={inputLocked ? t("生成中，不允许添加连线或节点") : undefined}
      type={side === "input" ? "target" : "source"}
    >
      <Plus aria-hidden size={16} strokeWidth={1.5} />
    </Handle>
  );
}
