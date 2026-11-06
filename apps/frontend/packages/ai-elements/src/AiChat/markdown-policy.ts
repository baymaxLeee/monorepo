import { harden } from "rehype-harden";
import { defaultRehypePlugins, type StreamdownProps, type StreamdownTranslations } from "streamdown";

// Model-generated images must not make ambient network requests. Uploaded and
// generated media use the authenticated Artifact/file-part path instead.
export const markdownRehypePlugins = [
  defaultRehypePlugins.raw,
  defaultRehypePlugins.sanitize,
  [
    harden,
    {
      allowedImagePrefixes: [],
      allowDataImages: false,
      allowedLinkPrefixes: ["*"],
      allowedProtocols: ["https", "http", "mailto"],
    },
  ],
] satisfies NonNullable<StreamdownProps["rehypePlugins"]>;

export const markdownTranslations = {
  copyCode: "复制代码",
  downloadFile: "下载文件",
  copied: "已复制",
  close: "关闭",
  copyTable: "复制表格",
  copyTableAsMarkdown: "复制为 Markdown",
  copyTableAsCsv: "复制为 CSV",
  copyTableAsTsv: "复制为 TSV",
  downloadTable: "下载表格",
  downloadTableAsCsv: "下载为 CSV",
  downloadTableAsMarkdown: "下载为 Markdown",
  downloadDiagram: "下载图表",
  downloadDiagramAsSvg: "下载为 SVG",
  downloadDiagramAsPng: "下载为 PNG",
  downloadDiagramAsMmd: "下载 Mermaid 源码",
  viewFullscreen: "全屏查看",
  exitFullscreen: "退出全屏",
  imageNotAvailable: "图片未自动加载",
  downloadImage: "下载图片",
  openExternalLink: "打开外部链接？",
  externalLinkWarning: "即将访问外部网站。",
  copyLink: "复制链接",
  openLink: "打开链接",
} satisfies Partial<StreamdownTranslations>;
