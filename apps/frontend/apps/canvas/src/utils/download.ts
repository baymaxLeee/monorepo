import { authFetch } from "@repo/api";

export async function downloadWithFetch(input: string | { url: string; name?: string }, filename?: string) {
  const url = typeof input === "string" ? input : input.url;
  const response = await authFetch(url);
  if (!response.ok) throw new Error(`下载失败（${response.status}）`);
  const href = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename ?? (typeof input === "string" ? undefined : input.name) ?? "download";
  anchor.click();
  URL.revokeObjectURL(href);
}

export function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}
