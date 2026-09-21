import { BaseEdge, type EdgeProps, type EdgeTypes, getBezierPath, useStore } from "@xyflow/react";

import styles from "./CanvasEdge.module.less";

function CanvasEdge(props: EdgeProps) {
  const connectedNodeSelected = useStore((state) =>
    Boolean(state.nodeLookup.get(props.source)?.selected || state.nodeLookup.get(props.target)?.selected),
  );
  const showFlow = connectedNodeSelected;
  const [path] = getBezierPath(props);

  return (
    <g className={`${styles.edge} ${props.selected ? styles.selected : ""}`}>
      <BaseEdge
        id={props.id}
        path={path}
        markerStart={props.markerStart}
        markerEnd={props.markerEnd}
        interactionWidth={props.interactionWidth}
      />
      {showFlow ? <path className={styles.flow} d={path} pathLength={100} /> : null}
    </g>
  );
}

export const canvasEdgeTypes: EdgeTypes = { default: CanvasEdge };
