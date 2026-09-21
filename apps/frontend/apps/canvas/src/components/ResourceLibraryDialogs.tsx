import { canvasCreateResource, canvasDeleteResource, canvasUpdateResource, type CanvasResource } from "@repo/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@repo/design-system";

import { NameDialog } from "./NameDialog";
import { ResourceAssets } from "./ResourceAssets";

type Props = {
  projectId: string;
  type: number;
  dialog: CanvasResource | "create" | null;
  setDialog: (value: CanvasResource | "create" | null) => void;
  managed: CanvasResource | null;
  setManaged: (value: CanvasResource | null) => void;
  deleting: CanvasResource | null;
  setDeleting: (value: CanvasResource | null) => void;
  busy: boolean;
  setBusy: (value: boolean) => void;
  refresh: () => void;
  onCopy?: (assetId: string) => Promise<void>;
};

export function ResourceLibraryDialogs({
  projectId,
  type,
  dialog,
  setDialog,
  managed,
  setManaged,
  deleting,
  setDeleting,
  busy,
  setBusy,
  refresh,
  onCopy,
}: Props) {
  return (
    <>
      {dialog ? (
        <NameDialog
          key={dialog === "create" ? "create" : dialog.id}
          open
          title={dialog === "create" ? "新建资产" : "编辑资产"}
          initialName={dialog === "create" ? "" : dialog.name}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            if (dialog === "create")
              await canvasCreateResource(projectId, { name, type, description: "", expected_revision: 0 });
            else
              await canvasUpdateResource(projectId, dialog.id, {
                name,
                type: dialog.type,
                description: dialog.description,
                expected_revision: dialog.revision,
              });
            refresh();
          }}
        />
      ) : null}
      <Dialog
        open={Boolean(managed)}
        onOpenChange={(open) => {
          if (!open) setManaged(null);
        }}
      >
        <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{managed?.name ?? "资产素材"}</DialogTitle>
          </DialogHeader>
          {managed ? (
            <ResourceAssets projectId={projectId} resource={managed} onChange={refresh} onCopy={onCopy} />
          ) : null}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除「{deleting?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后引用该资产的字段将失效。已经独立复制到画布的内容保留，此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                if (!deleting) return;
                setBusy(true);
                void canvasDeleteResource(projectId, deleting.id, { expected_revision: deleting.revision })
                  .then(() => {
                    setDeleting(null);
                    refresh();
                  })
                  .catch(() => {})
                  .finally(() => setBusy(false));
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
