import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/design-system";

export interface CanvasSelection {
  nodes: string[];
  edges: string[];
}
export function DeleteSelectionDialog({
  selection,
  busy,
  onClose,
  onConfirm,
}: {
  selection: CanvasSelection | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <AlertDialog
      open={Boolean(selection)}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除选中内容？</AlertDialogTitle>
          <AlertDialogDescription>
            将删除 {selection?.nodes.length ?? 0} 个节点和 {selection?.edges.length ?? 0}{" "}
            条选中的连线。节点的关联连线会一并移除。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              void onConfirm().catch(() => {});
            }}
          >
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
