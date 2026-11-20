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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/design-system";
import { getErrorMessage } from "@repo/shared";
import { DownloadIcon, MoreHorizontalIcon, RouteIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

export function ChatConversationActions({
  conversation,
  onDelete,
  nativeConfirmation = false,
  onExport,
  onOpenTrace,
}: {
  conversation: { id: string; title: string };
  nativeConfirmation?: boolean;
  onDelete: (id: string) => Promise<void>;
  onExport: (id: string) => Promise<void>;
  onOpenTrace?: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function remove() {
    setDeleting(true);
    setError(null);
    void onDelete(conversation.id)
      .then(() => setConfirming(false))
      .catch((cause) => setError(getErrorMessage(cause)))
      .finally(() => setDeleting(false));
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${conversation.title} 更多操作`}
              className="absolute right-0 top-0.5 opacity-0 group-hover/menu-item:opacity-100 group-focus-within/menu-item:opacity-100 data-popup-open:opacity-100"
            />
          }
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {onOpenTrace && (
            <DropdownMenuItem onClick={() => onOpenTrace(conversation.id)}>
              <RouteIcon />
              执行轨迹
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() => void onExport(conversation.id).catch((cause) => setError(getErrorMessage(cause)))}
          >
            <DownloadIcon />
            导出 Markdown
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={deleting}
            variant="destructive"
            onClick={() => {
              setError(null);
              if (nativeConfirmation) remove();
              else setConfirming(true);
            }}
          >
            <Trash2Icon />
            删除会话
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error && !confirming && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除此会话？</AlertDialogTitle>
            <AlertDialogDescription>“{conversation.title}”及其会话记录将被删除。</AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                remove();
              }}
            >
              {deleting ? "删除中…" : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
