import { canvasnode } from "@/domain";
import t from "@/utils/i18n";

import {
  type CanvasOutputPort,
  type CanvasPortCounts,
  type CanvasPortDataType,
  canvasPortProtocol,
  canvasPortsAreCompatible,
  resolveCanvasTargetPort,
} from "./portProtocol";

export type { CanvasPortCounts as CanvasNodePortCounts, CanvasPortDataType as CanvasNodeMedia } from "./portProtocol";

type CanvasNodeMedia = CanvasPortDataType;
export type CanvasNodePortSide = "input" | "output";
type CanvasNodePortCounts = CanvasPortCounts;

export type CanvasNodeInputPorts = {
  connection: readonly canvasnode.CanvasPort[];
  material: readonly canvasnode.CanvasPort[];
};
type CanvasNodeInputProfile = CanvasNodeInputPorts & {
  rejectionMessage?: string;
};
export type CanvasNodeProtocol = {
  createLabel: string;
  inputs: CanvasNodeInputPorts;
  label: string;
  output: CanvasOutputPort;
  quickCreateAsSource: boolean;
  quickCreateAsTarget: boolean;
  videoInputModes?: Partial<Record<canvasnode.CanvasVideoInputMode, CanvasNodeInputProfile>>;
};

const NO_INPUT_PORTS: CanvasNodeInputPorts = {
  connection: [],
  material: [],
};
const REFERENCE_MEDIA_PORTS = [
  canvasnode.CanvasPort.REFERENCE_IMAGE,
  canvasnode.CanvasPort.REFERENCE_VIDEO,
  canvasnode.CanvasPort.REFERENCE_AUDIO,
  canvasnode.CanvasPort.REFERENCE_TEXT,
] as const;
const REFERENCE_VISUAL_TEXT_PORTS = [
  canvasnode.CanvasPort.REFERENCE_IMAGE,
  canvasnode.CanvasPort.REFERENCE_VIDEO,
  canvasnode.CanvasPort.REFERENCE_TEXT,
] as const;
const VIDEO_FRAME_PORTS = [canvasnode.CanvasPort.FIRST_FRAME, canvasnode.CanvasPort.LAST_FRAME] as const;
const OUTPUT_PORT = canvasnode.CanvasPort.OUTPUT;

export const CANVAS_NODE_PROTOCOLS: Record<canvasnode.CanvasNodeType, CanvasNodeProtocol> = {
  [canvasnode.CanvasNodeType.IMAGE_ASSET]: {
    createLabel: "图片",
    inputs: NO_INPUT_PORTS,
    label: "图片",
    output: { dataType: "image", port: OUTPUT_PORT },
    quickCreateAsSource: false,
    quickCreateAsTarget: false,
  },
  [canvasnode.CanvasNodeType.VIDEO_ASSET]: {
    createLabel: "视频",
    inputs: NO_INPUT_PORTS,
    label: "视频",
    output: { dataType: "video", port: OUTPUT_PORT },
    quickCreateAsSource: false,
    quickCreateAsTarget: false,
  },
  [canvasnode.CanvasNodeType.AUDIO_ASSET]: {
    createLabel: "音频",
    inputs: NO_INPUT_PORTS,
    label: "音频",
    output: { dataType: "audio", port: OUTPUT_PORT },
    quickCreateAsSource: false,
    quickCreateAsTarget: false,
  },
  [canvasnode.CanvasNodeType.TEXT]: {
    createLabel: "文字",
    inputs: {
      connection: [],
      material: REFERENCE_MEDIA_PORTS,
    },
    label: "文本",
    output: { dataType: "text", port: OUTPUT_PORT },
    quickCreateAsSource: true,
    quickCreateAsTarget: false,
  },
  [canvasnode.CanvasNodeType.IMAGE_GENERATION]: {
    createLabel: "图片生成",
    inputs: {
      connection: [canvasnode.CanvasPort.REFERENCE_IMAGE, canvasnode.CanvasPort.REFERENCE_TEXT],
      material: [canvasnode.CanvasPort.REFERENCE_IMAGE, canvasnode.CanvasPort.REFERENCE_TEXT],
    },
    label: "图片生成",
    output: { dataType: "image", port: OUTPUT_PORT },
    quickCreateAsSource: true,
    quickCreateAsTarget: true,
  },
  [canvasnode.CanvasNodeType.VIDEO_GENERATION]: {
    createLabel: "视频生成",
    inputs: {
      connection: REFERENCE_MEDIA_PORTS,
      material: REFERENCE_MEDIA_PORTS,
    },
    label: "视频生成",
    output: { dataType: "video", port: OUTPUT_PORT },
    quickCreateAsSource: true,
    quickCreateAsTarget: true,
    videoInputModes: {
      [canvasnode.CanvasVideoInputMode.FIRST_LAST_FRAME]: {
        connection: VIDEO_FRAME_PORTS,
        material: VIDEO_FRAME_PORTS,
        rejectionMessage: "首尾帧模式仅支持连接图片素材",
      },
    },
  },
  [canvasnode.CanvasNodeType.TEXT_GENERATION]: {
    createLabel: "文本生成",
    inputs: {
      connection: REFERENCE_VISUAL_TEXT_PORTS,
      material: REFERENCE_VISUAL_TEXT_PORTS,
    },
    label: "文本生成",
    output: { dataType: "text", port: OUTPUT_PORT },
    quickCreateAsSource: true,
    quickCreateAsTarget: true,
  },
  [canvasnode.CanvasNodeType.STORYBOARD_DRAFT]: {
    createLabel: "批量分镜",
    inputs: NO_INPUT_PORTS,
    label: "批量分镜",
    output: { dataType: "text", port: OUTPUT_PORT },
    quickCreateAsSource: false,
    quickCreateAsTarget: false,
  },
};

const QUICK_CREATE_ORDER = [
  canvasnode.CanvasNodeType.TEXT_GENERATION,
  canvasnode.CanvasNodeType.IMAGE_GENERATION,
  canvasnode.CanvasNodeType.VIDEO_GENERATION,
  canvasnode.CanvasNodeType.TEXT,
] as const;

export function canvasNodeProtocol(type: canvasnode.CanvasNodeType) {
  return CANVAS_NODE_PROTOCOLS[type];
}

export function canConnectCanvasNodeTypes(
  sourceType: canvasnode.CanvasNodeType,
  targetType: canvasnode.CanvasNodeType,
) {
  const sourcePort = canvasNodeProtocol(sourceType).output;
  const targetPorts = canvasNodeProtocol(targetType).inputs.connection;
  return targetPorts.some((target) => canvasPortsAreCompatible(sourcePort, target));
}

/** 节点只组合 Port；输入模式仅替换当前生效的 Port 集合。 */
export function canvasNodeInputPorts(
  target: Pick<canvasnode.CanvasNode, "Type" | "VideoInputMode">,
  kind: keyof CanvasNodeInputPorts,
) {
  const protocol = canvasNodeProtocol(target.Type);
  const profile = target.VideoInputMode ? protocol.videoInputModes?.[target.VideoInputMode] : undefined;
  return profile?.[kind] ?? protocol.inputs[kind];
}

const CANVAS_NODE_MEDIA_TYPES: Record<CanvasPortDataType, canvasnode.CanvasNodeMediaType> = {
  image: canvasnode.CanvasNodeMediaType.IMAGE,
  video: canvasnode.CanvasNodeMediaType.VIDEO,
  audio: canvasnode.CanvasNodeMediaType.AUDIO,
  text: canvasnode.CanvasNodeMediaType.TEXT,
};

/** 将当前输入 Port 协议投影为服务端素材查询使用的通用媒体类型集合。 */
export function canvasNodeInputMediaTypes(
  target: Pick<canvasnode.CanvasNode, "Type" | "VideoInputMode">,
  kind: keyof CanvasNodeInputPorts,
) {
  return Array.from(
    new Set(
      canvasNodeInputPorts(target, kind).flatMap((port) => {
        const dataType = canvasPortProtocol(port).dataType;
        return dataType ? [CANVAS_NODE_MEDIA_TYPES[dataType]] : [];
      }),
    ),
  );
}

export type CanvasNodeInputResolution =
  | { accepted: true; targetPort: canvasnode.CanvasPort }
  | {
      accepted: false;
      media: CanvasNodeMedia;
      message?: string;
      reason: "cycle" | "deleted-reference" | "generating" | "incompatible" | "input-profile";
    };

/**
 * CanvasNode 输入协议的唯一前端判定入口：统一类型、Port 和输入模式。
 * 固定 Port 容量与模型动态素材上限均由 Server 根据最新状态做权威校验。
 */
export function resolveCanvasNodeInput(
  media: CanvasNodeMedia,
  target: Pick<canvasnode.CanvasNode, "IncomingEdges" | "Type" | "VideoInputMode"> &
    Partial<Pick<canvasnode.CanvasNode, "ActiveTaskRunID">>,
  options: {
    kind: "connection" | "material";
    slotCounts?: CanvasNodePortCounts;
    preferredPort?: canvasnode.CanvasPort;
    sourceNodeId?: string;
  },
): CanvasNodeInputResolution {
  if (target.ActiveTaskRunID) {
    return { accepted: false, media, reason: "generating" };
  }
  const protocol = canvasNodeProtocol(target.Type);
  const existingEdge = options.sourceNodeId
    ? target.IncomingEdges.find((edge) => edge.SourceNodeID === options.sourceNodeId)
    : undefined;
  if (existingEdge) {
    return { accepted: true, targetPort: existingEdge.TargetPort };
  }
  const portResolution = resolveCanvasTargetPort(
    { dataType: media, port: OUTPUT_PORT },
    canvasNodeInputPorts(target, options.kind),
    {
      edges: target.IncomingEdges,
      slotCounts: options.slotCounts,
      preferredPort: options.preferredPort,
    },
  );
  if (!portResolution.accepted) {
    const activeProfile = target.VideoInputMode ? protocol.videoInputModes?.[target.VideoInputMode] : undefined;
    return {
      accepted: false,
      media,
      message: activeProfile?.rejectionMessage,
      reason: activeProfile?.rejectionMessage ? "input-profile" : "incompatible",
    };
  }
  return portResolution;
}

/** Edge 连接从源节点的输出 Port 开始解析，不要求调用方了解素材类型。 */
export function resolveCanvasNodeConnection(
  source: Pick<canvasnode.CanvasNode, "NodeID" | "Type">,
  target: Pick<canvasnode.CanvasNode, "IncomingEdges" | "Type" | "VideoInputMode"> &
    Partial<Pick<canvasnode.CanvasNode, "ActiveTaskRunID">>,
  options: {
    slotCounts?: CanvasNodePortCounts;
    preferredPort?: canvasnode.CanvasPort;
  } = {},
): CanvasNodeInputResolution {
  const sourcePort = canvasNodeProtocol(source.Type).output;
  return resolveCanvasNodeInput(sourcePort.dataType, target, {
    kind: "connection",
    slotCounts: options.slotCounts,
    preferredPort: options.preferredPort,
    sourceNodeId: source.NodeID,
  });
}

const MEDIA_LABEL: Record<CanvasNodeMedia, string> = {
  image: t("图片"),
  video: t("视频"),
  audio: t("音频"),
  text: t("文本"),
};

export function canvasNodeInputWarning(result: Exclude<CanvasNodeInputResolution, { accepted: true }>) {
  if (result.reason === "cycle") {
    return t("连接会形成环路");
  }
  if (result.reason === "deleted-reference") {
    return t("引用素材已删除，无法连接");
  }
  if (result.reason === "generating") {
    return t("生成中的节点不可修改连接");
  }
  if (result.reason === "input-profile" && result.message) {
    return t(result.message);
  }
  const category = MEDIA_LABEL[result.media];
  return t("当前节点不支持连接{category}素材", { category });
}

export function quickCreateNodeTypes(anchor: canvasnode.CanvasNode, side: CanvasNodePortSide) {
  return QUICK_CREATE_ORDER.filter((type) =>
    side === "input"
      ? canvasNodeProtocol(type).quickCreateAsSource && canConnectCanvasNodeTypes(type, anchor.Type)
      : canvasNodeProtocol(type).quickCreateAsTarget && canConnectCanvasNodeTypes(anchor.Type, type),
  );
}
