import { canvasnode } from "@/domain";

export type CanvasPortDataType = "image" | "video" | "audio" | "text";
export type CanvasPortCounts = Partial<Record<canvasnode.CanvasPort, number>>;

export type CanvasOutputPort = {
  dataType: CanvasPortDataType;
  port: canvasnode.CanvasPort;
};

export type CanvasPortProtocol = {
  direction: "input" | "output";
  /** OUTPUT 的实际数据类型由节点挂载该 Port 时声明。 */
  dataType?: CanvasPortDataType;
};

export const CANVAS_PORT_PROTOCOLS: Record<canvasnode.CanvasPort, CanvasPortProtocol> = {
  [canvasnode.CanvasPort.OUTPUT]: { direction: "output" },
  [canvasnode.CanvasPort.REFERENCE_IMAGE]: {
    dataType: "image",
    direction: "input",
  },
  [canvasnode.CanvasPort.REFERENCE_VIDEO]: {
    dataType: "video",
    direction: "input",
  },
  [canvasnode.CanvasPort.REFERENCE_AUDIO]: {
    dataType: "audio",
    direction: "input",
  },
  [canvasnode.CanvasPort.REFERENCE_TEXT]: {
    dataType: "text",
    direction: "input",
  },
  [canvasnode.CanvasPort.FIRST_FRAME]: {
    dataType: "image",
    direction: "input",
  },
  [canvasnode.CanvasPort.LAST_FRAME]: {
    dataType: "image",
    direction: "input",
  },
};

export function canvasPortProtocol(port: canvasnode.CanvasPort) {
  return CANVAS_PORT_PROTOCOLS[port];
}

export function canvasPortsAreCompatible(source: CanvasOutputPort, targetPort: canvasnode.CanvasPort) {
  const target = canvasPortProtocol(targetPort);
  return target.direction === "input" && target.dataType === source.dataType;
}

export type CanvasTargetPortResolution =
  | { accepted: true; targetPort: canvasnode.CanvasPort }
  | { accepted: false; reason: "incompatible" };

function portInputCount(
  port: canvasnode.CanvasPort,
  edges: readonly Pick<canvasnode.CanvasEdge, "TargetPort">[],
  slotCounts?: CanvasPortCounts,
) {
  if (slotCounts?.[port] !== undefined) return slotCounts[port] ?? 0;
  return edges.filter((edge) => edge.TargetPort === port).length;
}

/**
 * 根据两端 Port 协议解析目标 Port。当前占用只用于自动选择 slot，
 * 不在前端拒绝连接；容量由服务端基于事务内最新图做权威校验。
 */
export function resolveCanvasTargetPort(
  source: CanvasOutputPort,
  targetPorts: readonly canvasnode.CanvasPort[],
  options: {
    edges: readonly Pick<canvasnode.CanvasEdge, "TargetPort">[];
    slotCounts?: CanvasPortCounts;
    preferredPort?: canvasnode.CanvasPort;
  },
): CanvasTargetPortResolution {
  const candidatePorts = targetPorts.filter((port) => canvasPortsAreCompatible(source, port));
  if (!candidatePorts.length) {
    return { accepted: false, reason: "incompatible" };
  }

  const orderedPorts = options.preferredPort
    ? [
        ...candidatePorts.filter((port) => port === options.preferredPort),
        ...candidatePorts.filter((port) => port !== options.preferredPort),
      ]
    : candidatePorts;
  const targetPort = orderedPorts.reduce((selected, port) =>
    portInputCount(port, options.edges, options.slotCounts) <
    portInputCount(selected, options.edges, options.slotCounts)
      ? port
      : selected,
  );
  return { accepted: true, targetPort };
}
