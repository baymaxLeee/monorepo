import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
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
    choices: question.choices.map((choice) => ({ value: choice.value })),
  }));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    onSubmit({
      answers: input.questions.map((question) => ({
        id: question.id,
        values: formData
          .getAll(question.id)
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean),
      })),
    });
  }

  return (
    <Questionnaire className="rounded-lg border bg-muted/30 p-4" items={items} shortcuts="numbers" onSubmit={submit}>
      {input.questions.length > 1 ? <QuestionnaireProgress aria-label="答题进度" /> : null}
      {input.questions.map((question) => (
        <QuestionnaireItem key={question.id} name={question.id} multiple={question.mode === "multiple"} required>
          <QuestionnaireTitle>{question.question}</QuestionnaireTitle>
          {question.choices.length > 0 ? (
            <QuestionnaireChoices>
              {question.choices.map((choice) => (
                <QuestionnaireChoice key={choice.value} value={choice.value}>
                  {choice.label}
                </QuestionnaireChoice>
              ))}
            </QuestionnaireChoices>
          ) : null}
          {question.allowFreeform ? (
            <QuestionnaireInput
              aria-label={question.freeformLabel}
              maxLength={160}
              placeholder={question.freeformLabel}
            />
          ) : null}
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
