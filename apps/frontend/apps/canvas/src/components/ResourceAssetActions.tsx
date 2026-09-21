import {
  canvasDeleteResourceAsset,
  canvasListResourceVersions,
  canvasReplaceResourceAsset,
  canvasSetPrimaryResourceAsset,
  canvasUpdateResourceAsset,
  type CanvasResource,
  type CanvasResourceAsset,
  type CanvasResourceVersion,
} from "@repo/api";
import {
  Button,
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@repo/design-system";
import { useRef, useState } from "react";

import { NameDialog } from "./NameDialog";
import { ResourceMedia } from "./ResourceMedia";

export function ResourceAssetActions({
  projectId,
  resource,
  asset,
  onChange,
}: {
  projectId: string;
  resource: CanvasResource;
  asset: CanvasResourceAsset;
  onChange: () => void;
}) {
  const upload = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [rename, setRename] = useState(false);
  const [deletion, setDeletion] = useState(false);
  const [history, setHistory] = useState<CanvasResourceVersion[] | null>(null);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      onChange();
    } catch {
      /* Shared API notifications report the error. */
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        {resource.primary_resource_asset_id === asset.id ? (
          <Badge variant="secondary">主素材</Badge>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(() =>
                canvasSetPrimaryResourceAsset(projectId, asset.id, { expected_revision: resource.revision }),
              )
            }
          >
            设为主素材
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => upload.current?.click()}>
          替换素材
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void run(async () => setHistory((await canvasListResourceVersions(projectId, asset.id)).items))
          }
        >
          历史版本
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRename(true)}>
          重命名
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDeletion(true)}>
          删除
        </Button>
      </div>
      <input
        ref={upload}
        type="file"
        className="hidden"
        aria-label="替换素材"
        accept={asset.media_type === 3 ? "audio/*" : "image/*"}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void run(() => canvasReplaceResourceAsset(projectId, asset.id, String(asset.revision), file));
        }}
      />
      {rename ? (
        <NameDialog
          title="重命名素材"
          open
          initialName={asset.name}
          onClose={() => setRename(false)}
          onSubmit={async (name) => {
            await canvasUpdateResourceAsset(projectId, asset.id, {
              expected_revision: asset.revision,
              name,
              revision_no: 0,
            });
            onChange();
          }}
        />
      ) : null}
      <AlertDialog
        open={deletion}
        onOpenChange={(open) => {
          if (!busy) setDeletion(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除「{asset.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除此素材及其历史版本入口。已独立复制到画布的素材仍保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                void run(async () => {
                  await canvasDeleteResourceAsset(projectId, asset.id, { expected_revision: asset.revision });
                  setDeletion(false);
                });
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={history !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setHistory(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{asset.name} · 历史版本</DialogTitle>
          </DialogHeader>
          <div className="max-h-[65vh] space-y-3 overflow-auto">
            {history?.map((version) => (
              <div key={version.revision_no} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <span>
                    版本 {version.revision_no} · {new Date(version.created_at).toLocaleString()}
                  </span>
                  {version.current ? (
                    <Badge>当前版本</Badge>
                  ) : (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await canvasUpdateResourceAsset(projectId, asset.id, {
                            expected_revision: asset.revision,
                            name: asset.name,
                            revision_no: version.revision_no,
                          });
                          setHistory(null);
                        })
                      }
                    >
                      使用此版本
                    </Button>
                  )}
                </div>
                <ResourceMedia
                  projectId={projectId}
                  assetId={asset.id}
                  name={asset.name}
                  type={asset.media_type}
                  revision={version.revision_no}
                />
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
