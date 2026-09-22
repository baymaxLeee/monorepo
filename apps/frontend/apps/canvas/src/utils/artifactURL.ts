export function resolveArtifactURL(previewURL: string) {
  if (!previewURL) {
    return undefined;
  }
  if (/^(https?:\/\/|blob:|data:|\/)/.test(previewURL)) {
    return previewURL;
  }
  return `/${previewURL.replace(/^\/+/, "")}`;
}
