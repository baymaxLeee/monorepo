import { ToolJsonBlock } from "components/ai-chat";
import {
  type AskUserInput,
  answerLabels,
  parseAskUserOutput,
} from "../lib/ask-user";

export function AskUserAnsweredCard({
  input,
  output,
}: {
  input: AskUserInput;
  output: unknown;
}) {
  const parsed = parseAskUserOutput(output);
  if (!parsed) return <ToolJsonBlock value={output} />;
  const answers = new Map(parsed.answers.map((answer) => [answer.id, answer]));
  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      {input.questions.map((question) => {
        const answer = answers.get(question.id);
        return answer ? (
          <div key={question.id} className="space-y-1">
            <div className="text-xs text-muted-foreground">
              {question.question}
            </div>
            <div className="whitespace-pre-wrap break-words text-sm">
              {answerLabels(question, answer.values)}
            </div>
          </div>
        ) : null;
      })}
    </div>
  );
}
