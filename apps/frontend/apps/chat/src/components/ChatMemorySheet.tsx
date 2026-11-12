import { useChatStore } from "@repo/ai-elements/conversation/store/useChatStore";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@repo/design-system";

import { MemoryPanel } from "./MemoryPanel";

export function ChatMemorySheet() {
  const open = useChatStore((s) => s.memoryPanelOpen);
  const setOpen = useChatStore((s) => s.setMemoryPanelOpen);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>记忆</SheetTitle>
          <SheetDescription>管理当前用户的长期记忆</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-auto">
          <MemoryPanel open={open} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
