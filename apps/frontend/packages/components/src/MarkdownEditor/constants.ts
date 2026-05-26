export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/avif",
]);

export const ALLOWED_IMAGE_ACCEPT = [...ALLOWED_IMAGE_MIME_TYPES].join(",");

export const isAllowedImageFile = (file: File): boolean =>
  ALLOWED_IMAGE_MIME_TYPES.has(file.type);

export const URL_REGEX =
  /^\s*(https?:\/\/)?(localhost|\d{1,3}(\.\d{1,3}){3}|([a-zA-Z\d]([a-zA-Z\d-]{0,61}[a-zA-Z\d])?\.)+[a-zA-Z]{2,})(:\d{1,5})?(\/[a-zA-Z\d\-._~:/?#[\]@!$&'()*+,;=%]*)?\s*$/;

export enum AiPolishStatus {
  Pending = "pending",
  Loading = "loading",
  Ready = "ready",
}

export const FONT_COLORS = [
  { label: "默认", color: "inherit" },
  { label: "灰色", color: "#86909C" },
  { label: "红色", color: "#F53F3F" },
  { label: "橙色", color: "#F77234" },
  { label: "黄色", color: "#FADC19" },
  { label: "绿色", color: "#00B42A" },
  { label: "蓝色", color: "#165DFF" },
  { label: "紫色", color: "#722ED1" },
];

export const BG_COLORS = [
  { label: "无", color: "transparent" },
  { label: "浅灰", color: "#F2F3F5" },
  { label: "浅红", color: "#FFE8E8" },
  { label: "浅橙", color: "#FFF3E8" },
  { label: "浅黄", color: "#FFFCE8" },
  { label: "浅绿", color: "#E8FFEA" },
  { label: "浅蓝", color: "#E8F3FF" },
  { label: "浅紫", color: "#F5F2FF" },
  { label: "灰色", color: "#E5E6EB" },
  { label: "深灰", color: "#C9CDD4" },
  { label: "中红", color: "#FFBABA" },
  { label: "中橙", color: "#FFD4B2" },
  { label: "中黄", color: "#FFF1B5" },
  { label: "中绿", color: "#B7F4C1" },
  { label: "中蓝", color: "#B3D7FF" },
  { label: "中紫", color: "#E1DAFF" },
];
