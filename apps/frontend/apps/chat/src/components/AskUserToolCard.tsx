import { Button, Checkbox, Input } from "@repo/design-system";
import { useId, useState } from "react";

import type { AskUserInput, AskUserOutput, AskUserQuestion } from "../lib/ask-user";

export function AskUserToolCard({
  input,
  onSubmit,
}: {
  input: AskUserInput;
  onSubmit: (output: AskUserOutput) => void;
}) {
  const formId = useId();
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [freeform, setFreeform] = useState<Record<string, string>>({});
  const valuesFor = (question: AskUserQuestion) => {
    const values = selected[question.id] ?? [];
    const other = freeform[question.id]?.trim();
    return other ? [...values, other] : values;
  };
  const canSubmit = input.questions.every((question) => valuesFor(question).length > 0);

  function select(question: AskUserQuestion, value: string) {
    setSelected((current) => {
      const values = current[question.id] ?? [];
      return {
        ...current,
        [question.id]:
          question.mode === "single"
            ? [value]
            : values.includes(value)
              ? values.filter((item) => item !== value)
              : [...values, value],
      };
    });
    if (question.mode === "single") {
      setFreeform((current) => ({ ...current, [question.id]: "" }));
    }
  }

  return (
    <div className="space-y-4 rounded-md border bg-muted/30 p-3">
      {input.questions.map((question, questionIndex) => (
        <fieldset key={question.id} className="space-y-2">
          <legend className="text-sm font-medium leading-relaxed">
            {input.questions.length > 1 ? `${questionIndex + 1}. ` : ""}
            {question.question}
          </legend>
          <div className={question.mode === "multiple" ? "space-y-2" : "flex flex-wrap gap-2"}>
            {question.choices.map((choice, choiceIndex) => {
              const checked = (selected[question.id] ?? []).includes(choice.value);
              const checkboxId = `${formId}-${questionIndex}-${choiceIndex}`;
              return question.mode === "multiple" ? (
                <div
                  key={choice.value}
                  className="flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm"
                >
                  <Checkbox id={checkboxId} checked={checked} onCheckedChange={() => select(question, choice.value)} />
                  <label className="flex-1 cursor-pointer" htmlFor={checkboxId}>
                    {choice.label}
                  </label>
                </div>
              ) : (
                <Button
                  key={choice.value}
                  type="button"
                  size="sm"
                  variant={checked ? "default" : "outline"}
                  aria-pressed={checked}
                  onClick={() => select(question, choice.value)}
                >
                  {choice.label}
                </Button>
              );
            })}
          </div>
          {question.allowFreeform ? (
            <Input
              value={freeform[question.id] ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                setFreeform((current) => ({
                  ...current,
                  [question.id]: value,
                }));
                if (question.mode === "single" && value) {
                  setSelected((current) => ({ ...current, [question.id]: [] }));
                }
              }}
              maxLength={160}
              placeholder={question.freeformLabel}
            />
          ) : null}
        </fieldset>
      ))}
      <Button
        type="button"
        size="sm"
        disabled={!canSubmit}
        onClick={() =>
          onSubmit({
            answers: input.questions.map((question) => ({
              id: question.id,
              values: valuesFor(question),
            })),
          })
        }
      >
        提交
      </Button>
    </div>
  );
}
