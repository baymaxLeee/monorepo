import { resource } from "@/domain";
import t from "@/utils/i18n";

export const RESOURCE_TYPE_OPTIONS = [
  { label: t("角色"), value: resource.ResourceType.CHARACTER },
  { label: t("场景"), value: resource.ResourceType.SCENE },
  { label: t("道具"), value: resource.ResourceType.PROP },
  { label: t("音频"), value: resource.ResourceType.AUDIO },
] as const;

/** 图片单张大小上限（对齐后端 asset.go 白名单：≤30MB）。 */
export const IMAGE_MAX_SIZE_BYTES = 30 * 1024 * 1024;
/** 音频单个文件大小上限（对齐后端：wav/mp3 ≤15MB）。 */
export const AUDIO_MAX_SIZE_BYTES = 15 * 1024 * 1024;

/**
 * 图片格式白名单，对齐后端 artifact/up.go 的 8 种格式；
 * 同时用于 input accept 与上传前的本地格式校验。
 */
export const IMAGE_ACCEPT_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".bmp",
  ".tiff",
  ".tif",
  ".gif",
  ".heic",
  ".heif",
] as const;

export const IMAGE_ACCEPT_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "image/gif",
  "image/heic",
  "image/heif",
] as const;

export const AUDIO_ACCEPT_EXTENSIONS = [".mp3", ".wav"] as const;
export const AUDIO_ACCEPT_MIME = ["audio/mpeg", "audio/wav"] as const;

export const RESOURCE_NAME_MAX_LENGTH = 128;

export function getResourceNameFromFile(fileName: string) {
  const nameWithoutExtension = fileName.replace(/\.[^./]+$/, "") || fileName;
  return [...nameWithoutExtension].slice(0, RESOURCE_NAME_MAX_LENGTH).join("");
}

export function getResourceTypeLabel(type: resource.ResourceType) {
  return RESOURCE_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? t("资产");
}

export function getResourceGenerationPromptPlaceholder(type: resource.ResourceType, materialName: string) {
  if (type === resource.ResourceType.SCENE) {
    return t("请输入该场景的描述文本，如自然环境、植被状况、建筑结构、所属朝代、建筑风格、家具状况、天气情况等");
  }
  if (type === resource.ResourceType.PROP) {
    return t("请输入该道具的描述文本，如物品的形状、大小、颜色、材质、磨损程度、风格等");
  }
  return t("输入人物的{materialName}描述，如人物性别、年龄、种族、国籍、体型、发型、身材、服装、气质等", {
    materialName,
  });
}

export function getResourceFileConfig(type: resource.ResourceType) {
  if (type === resource.ResourceType.AUDIO) {
    return {
      accept: [...AUDIO_ACCEPT_EXTENSIONS, ...AUDIO_ACCEPT_MIME].join(","),
      emptyHint: t("点击添加素材上传音频"),
      hint: t("支持 MP3、WAV，单个文件不超过 15MB"),
      maxSizeBytes: AUDIO_MAX_SIZE_BYTES,
      acceptExtensions: AUDIO_ACCEPT_EXTENSIONS,
      acceptMimes: AUDIO_ACCEPT_MIME,
    };
  }
  return {
    accept: [...IMAGE_ACCEPT_EXTENSIONS, ...IMAGE_ACCEPT_MIME].join(","),
    emptyHint: t("点击添加素材上传图片"),
    hint: t("支持 JPG、PNG、WebP、BMP、TIFF、GIF、HEIC、HEIF，单个文件不超过 30MB"),
    maxSizeBytes: IMAGE_MAX_SIZE_BYTES,
    acceptExtensions: IMAGE_ACCEPT_EXTENSIONS,
    acceptMimes: IMAGE_ACCEPT_MIME,
  };
}

/**
 * 上传前的本地格式 + 大小校验，返回错误文案（无错误返回空串）。
 * 后端仍做权威校验，这里只做体验层即时拦截。
 */
export function validateResourceFile(type: resource.ResourceType, file: File): string {
  const config = getResourceFileConfig(type);
  const lowerName = file.name.toLowerCase();
  const extMatched = config.acceptExtensions.some((ext) => lowerName.endsWith(ext));
  const mimeMatched = file.type ? (config.acceptMimes as readonly string[]).includes(file.type) : false;
  if (!extMatched && !mimeMatched) {
    return t("不在文件上传约束范围内");
  }
  if (file.size > config.maxSizeBytes) {
    const maxMB = Math.round(config.maxSizeBytes / (1024 * 1024));
    return t("文件超过大小上限（{max}MB）", { max: maxMB });
  }
  return "";
}
