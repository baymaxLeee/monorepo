import { ArtifactPreview, type ArtifactPreviewProps, resolveArtifactPreviewKind } from "@repo/ai-elements";
import { type StorageDeliveryRef } from "@repo/api";
import { Button } from "@repo/design-system";
import { CodeEditor } from "@repo/editors/code-editor";
import { MarkdownEditor } from "@repo/editors/markdown-editor";

import { useStorageResource } from "../hooks/useStorageResource";

export function ChatArtifactPreview({ asset, ...props }: ArtifactPreviewProps & { asset?: StorageDeliveryRef }) {
  const kind = resolveArtifactPreviewKind(props.kind, props.mimeType, props.filename);
  const resource = useStorageResource(asset, kind === "text" || kind === "markdown" || kind === "html");
  if (asset && resource.loading)
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载中…</div>;
  if (asset && resource.error)
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-2 p-4 text-sm text-muted-foreground"
        role="alert"
      >
        无法加载预览
        <Button variant="outline" onClick={resource.retry}>
          重试
        </Button>
      </div>
    );
  return (
    <ArtifactPreview
      {...props}
      src={asset && kind !== "html" ? resource.capability?.url : props.src}
      htmlBaseUrl={asset && kind === "html" ? resource.capability?.url : undefined}
      content={asset ? (resource.content ?? "") : props.content}
      onResourceError={asset ? resource.onResourceError : undefined}
      renderMarkdown={(content) => (
        <MarkdownEditor
          value={content}
          contentType="markdown"
          editable={false}
          features={{ blockDrag: false, blockMenu: false, codeBlock: true }}
          className="h-full min-h-0 w-full"
        />
      )}
      renderText={(content) => (
        <CodeEditor value={content} fileName={props.filename} readOnly className="h-full min-h-0 w-full" />
      )}
    />
  );
}
