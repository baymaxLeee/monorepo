import type { ComponentProps, ReactNode } from "react";

import { ChatStream } from "./ChatStream";

export function ConversationSessionView({
  title,
  issue,
  composer,
  overlay,
  ...stream
}: ComponentProps<typeof ChatStream> & {
  title: string;
  issue?: ReactNode;
  composer: ReactNode;
  overlay?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center justify-center px-14">
        <h1 className="max-w-full truncate text-sm font-medium text-foreground">{title}</h1>
      </header>
      <ChatStream {...stream} />
      {issue}
      {composer}
      {overlay}
    </div>
  );
}
