import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireChoiceDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@repo/design-system";
import type { FormEvent } from "react";

import type { AskUserInput, AskUserOutput } from "../lib/ask-user";

export function AskUserToolCard({
  input,
  onSubmit,
}: {
  input: AskUserInput;
  onSubmit: (output: AskUserOutput) => void;
}) {
  const items = input.questions.map((question) => ({
    name: question.id,
    required: true,
    choices: question.options.map((choice) => ({ value: choice.label })),
  }));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    onSubmit({
      answers: Object.fromEntries(
        input.questions.map((question) => [
          question.id,
          {
            answers: formData
              .getAll(question.id)
              .filter((value): value is string => typeof value === "string")
              .map((value) => value.trim())
              .filter(Boolean),
          },
        ]),
      ),
    });
  }

  return (
    <Questionnaire className="rounded-lg border bg-muted/30 p-4" items={items} shortcuts="numbers" onSubmit={submit}>
      {input.questions.length > 1 ? <QuestionnaireProgress aria-label="答题进度" /> : null}
      {input.questions.map((question) => (
        <QuestionnaireItem key={question.id} name={question.id} required>
          <div className="text-xs text-muted-foreground">{question.header}</div>
          <QuestionnaireTitle>{question.question}</QuestionnaireTitle>
          <QuestionnaireChoices>
            {question.options.map((option) => (
              <QuestionnaireChoice key={option.label} value={option.label}>
                {option.label}
                <QuestionnaireChoiceDescription>{option.description}</QuestionnaireChoiceDescription>
              </QuestionnaireChoice>
            ))}
          </QuestionnaireChoices>
          <QuestionnaireInput aria-label="其他" placeholder="其他" />
          <QuestionnaireError>请选择或输入一个答案后继续。</QuestionnaireError>
        </QuestionnaireItem>
      ))}
      <QuestionnaireActions>
        <QuestionnairePrevious>上一步</QuestionnairePrevious>
        <QuestionnaireNext>下一步</QuestionnaireNext>
        <QuestionnaireSubmit>提交</QuestionnaireSubmit>
      </QuestionnaireActions>
    </Questionnaire>
  );
}
