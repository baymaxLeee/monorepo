import { type Conversation } from "@repo/api/chat";
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
import { DownloadIcon, MoreHorizontalIcon, RouteIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

export function ChatConversationActions({
  conversation,
  onDelete,
  onExport,
  onOpenTrace,
}: {
  conversation: Conversation;
  onDelete: (id: string) => Promise<void>;
  onExport: (id: string) => Promise<void>;
  onOpenTrace: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
          <DropdownMenuItem onClick={() => onOpenTrace(conversation.id)}>
            <RouteIcon />
            执行轨迹
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void onExport(conversation.id).catch(() => {})}>
            <DownloadIcon />
            导出 Markdown
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setConfirming(true)}>
            <Trash2Icon />
            删除会话
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除此会话？</AlertDialogTitle>
            <AlertDialogDescription>“{conversation.title}”及其会话记录将被删除。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                setDeleting(true);
                void onDelete(conversation.id)
                  .then(() => setConfirming(false))
                  .catch(() => {})
                  .finally(() => setDeleting(false));
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
