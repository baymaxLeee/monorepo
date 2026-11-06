import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@repo/design-system";
import { MessageCircleIcon } from "lucide-react";

export function ConversationListPage() {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MessageCircleIcon />
        </EmptyMedia>
        <EmptyTitle>开始一个会话</EmptyTitle>
        <EmptyDescription>从左侧选择会话，或新建会话开始。</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
