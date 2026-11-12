import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from "@repo/design-system";
import { useContext, useEffect } from "react";
import { UNSAFE_DataRouterContext, useBlocker } from "react-router-dom";

export function ArtifactUnsavedChanges({
  open,
  saving,
  resolve,
  save,
}: {
  open: boolean;
  saving: boolean;
  resolve: (allowed: boolean) => void;
  save: () => Promise<boolean>;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && resolve(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>保存对文件的修改？</AlertDialogTitle>
          <AlertDialogDescription>此文件还有未保存的修改。你可以先保存、放弃修改，或继续编辑。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => resolve(false)}>继续编辑</AlertDialogCancel>
          <Button variant="outline" disabled={saving} onClick={() => resolve(true)}>
            放弃修改
          </Button>
          <AlertDialogAction
            disabled={saving}
            onClick={(event) => {
              event.preventDefault();
              void save().then((saved) => {
                if (saved) resolve(true);
              });
            }}
          >
            {saving ? "保存中…" : "保存并继续"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ArtifactRouteGuard(props: { dirty: boolean; confirm: () => Promise<boolean> }) {
  const router = useContext(UNSAFE_DataRouterContext);
  return router ? <RouterGuard {...props} /> : null;
}

function RouterGuard({ dirty, confirm }: { dirty: boolean; confirm: () => Promise<boolean> }) {
  const blocker = useBlocker(dirty);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    let active = true;
    void confirm().then((allowed) => {
      if (!active) return;
      if (allowed) blocker.proceed();
      else blocker.reset();
    });
    return () => {
      active = false;
    };
  }, [blocker, confirm]);
  return null;
}
