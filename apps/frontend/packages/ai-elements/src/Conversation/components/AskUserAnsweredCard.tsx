import { ToolJsonBlock } from "@repo/ai-elements";

import { type AskUserInput, parseAskUserOutput } from "../lib/ask-user";

export function AskUserAnsweredCard({ input, output }: { input: AskUserInput; output: unknown }) {
  const parsed = parseAskUserOutput(output);
  if (!parsed) {
    return <ToolJsonBlock value={output} />;
  }
  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      {input.questions.map((question) => {
        const answer = parsed.answers[question.id];
        return answer ? (
          <div key={question.id} className="space-y-1">
            <div className="text-xs text-muted-foreground">{question.question}</div>
            <div className="whitespace-pre-wrap break-words text-sm">{answer.answers.join("、")}</div>
          </div>
        ) : null;
      })}
    </div>
  );
}
