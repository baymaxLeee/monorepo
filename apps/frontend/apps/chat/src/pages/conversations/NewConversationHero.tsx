import { BadgeIcon, BotIcon, TerminalIcon } from "lucide-react";

export function NewConversationHero({ desktop, target }: { desktop: boolean; target: string }) {
  return desktop ? (
    <div className="flex flex-1 flex-col items-center justify-center gap-7 px-6 pb-10 text-center">
      <span className="relative flex size-12 items-center justify-center text-muted-foreground/55">
        <BadgeIcon className="absolute inset-0 size-full" strokeWidth={1.35} aria-hidden="true" />
        <TerminalIcon className="size-5" strokeWidth={1.7} aria-hidden="true" />
      </span>
      <h1 className="text-3xl font-normal tracking-tight">
        你想让我们在 <span className="underline decoration-dotted underline-offset-8">{target}</span> 中构建什么？
      </h1>
    </div>
  ) : (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 pb-8 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl border bg-card text-muted-foreground shadow-sm">
        <BotIcon className="size-6" aria-hidden="true" />
      </span>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">有什么可以帮你？</h1>
    </div>
  );
}

export function localProjectLabel(project: string | null) {
  return project?.split(/[\\/]/).filter(Boolean).at(-1) || "项目";
}
