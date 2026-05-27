import {
  BookOpenText,
  Container,
  Database,
  FileArchive,
  FileAudio2,
  FileCode2,
  FileCog,
  FileImage,
  FileJson2,
  FileKey2,
  FileLock2,
  FileQuestion,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType2,
  FileVideo2,
  GitBranch,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";
import { forwardRef } from "react";
import { cn } from "shared";

export interface FileIconProps extends Omit<LucideProps, "ref"> {
  filename: string;
}

const FILE_ICON_MAP: Record<string, LucideIcon> = {
  "7z": FileArchive,
  ai: FileImage,
  avi: FileVideo2,
  bash: FileTerminal,
  bmp: FileImage,
  c: FileCode2,
  cc: FileCode2,
  conf: FileCog,
  cpp: FileCode2,
  cs: FileCode2,
  css: FileType2,
  csv: FileSpreadsheet,
  db: Database,
  dockerfile: Container,
  doc: FileText,
  docx: FileText,
  env: FileCog,
  gif: FileImage,
  gitignore: GitBranch,
  go: FileCode2,
  gz: FileArchive,
  h: FileCode2,
  hpp: FileCode2,
  htm: FileCode2,
  html: FileCode2,
  ini: FileCog,
  java: FileCode2,
  jpeg: FileImage,
  jpg: FileImage,
  js: FileCode2,
  json: FileJson2,
  jsx: FileCode2,
  key: FileKey2,
  lock: FileLock2,
  log: FileText,
  m4a: FileAudio2,
  makefile: FileTerminal,
  md: BookOpenText,
  mdx: BookOpenText,
  mov: FileVideo2,
  mp3: FileAudio2,
  mp4: FileVideo2,
  npmrc: FileCog,
  odp: FileText,
  ods: FileSpreadsheet,
  odt: FileText,
  pdf: FileText,
  pem: FileKey2,
  png: FileImage,
  ppt: FileText,
  pptx: FileText,
  proto: FileCode2,
  py: FileCode2,
  rar: FileArchive,
  rb: FileCode2,
  rs: FileCode2,
  sass: FileType2,
  scss: FileType2,
  sh: FileTerminal,
  sql: Database,
  sqlite: Database,
  svg: FileImage,
  tar: FileArchive,
  toml: FileCog,
  ts: FileCode2,
  tsx: FileCode2,
  txt: FileText,
  wav: FileAudio2,
  webm: FileVideo2,
  xls: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  xml: FileCode2,
  yaml: FileCog,
  yml: FileCog,
  zip: FileArchive,
};

function getFileExt(filename: string): string {
  const normalized = filename.trim().toLowerCase();
  const cleanName = normalized.startsWith(".")
    ? normalized.slice(1)
    : normalized;
  const index = cleanName.lastIndexOf(".");
  return index >= 0 ? cleanName.slice(index + 1) : cleanName;
}

export function getFileIcon(filename: string): LucideIcon {
  return FILE_ICON_MAP[getFileExt(filename)] ?? FileQuestion;
}

export const FileIcon = forwardRef<SVGSVGElement, FileIconProps>(
  ({ filename, className, size = 16, strokeWidth = 2, ...props }, ref) => {
    const Icon = getFileIcon(filename);

    return (
      <Icon
        ref={ref}
        aria-hidden="true"
        size={size}
        strokeWidth={strokeWidth}
        className={cn("shrink-0", className)}
        {...props}
      />
    );
  },
);

FileIcon.displayName = "FileIcon";
