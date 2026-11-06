import { SidebarProvider } from "@repo/design-system";

import { ChatAuxiliaryPanels } from "../../components/ChatAuxiliaryPanels";
import { ChatPanels } from "../../components/ChatPanels";

export function ChatLayout() {
  return (
    <SidebarProvider className="h-dvh min-h-0 overflow-hidden bg-background">
      <ChatPanels />
      <ChatAuxiliaryPanels />
    </SidebarProvider>
  );
}
