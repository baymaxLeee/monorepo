export type AskUserQuestion = {
  id: string;
  question: string;
  choices: Array<{ label: string; value: string }>;
  mode: "single" | "multiple";
  allowFreeform: boolean;
  freeformLabel: string;
};

export type AskUserInput = {
  questions: AskUserQuestion[];
};

export type AskUserOutput = {
  answers: Array<{ id: string; values: string[] }>;
};

function parseQuestion(input: unknown): AskUserQuestion | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  if (
    typeof raw.id !== "string" ||
    !raw.id.trim() ||
    typeof raw.question !== "string" ||
    !raw.question.trim()
  ) {
    return null;
  }
  const choices = Array.isArray(raw.choices)
    ? raw.choices.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const choice = item as Record<string, unknown>;
        return typeof choice.label === "string" &&
          typeof choice.value === "string"
          ? [{ label: choice.label, value: choice.value }]
          : [];
      })
    : [];
  return {
    id: raw.id,
    question: raw.question,
    choices,
    mode: raw.mode === "multiple" ? "multiple" : "single",
    allowFreeform: raw.allow_freeform !== false,
    freeformLabel:
      typeof raw.freeform_label === "string" && raw.freeform_label.trim()
        ? raw.freeform_label.trim()
        : "其他",
  };
}

export function parseAskUserInput(input: unknown): AskUserInput | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as { questions?: unknown };
  if (!Array.isArray(raw.questions) || raw.questions.length === 0) return null;
  const questions = raw.questions.map(parseQuestion);
  return questions.every((question) => question != null) ? { questions } : null;
}

export function parseAskUserOutput(output: unknown): AskUserOutput | null {
  if (!output || typeof output !== "object") return null;
  const envelope = output as { status?: unknown; data?: unknown };
  if (
    envelope.status !== "completed" ||
    !envelope.data ||
    typeof envelope.data !== "object"
  ) {
    return null;
  }
  const raw = envelope.data as { answers?: unknown };
  if (!Array.isArray(raw.answers) || raw.answers.length === 0) return null;
  const answers = raw.answers.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const answer = item as Record<string, unknown>;
    const values = Array.isArray(answer.values)
      ? answer.values.filter(
          (value): value is string =>
            typeof value === "string" && value.trim() !== "",
        )
      : [];
    return typeof answer.id === "string" && values.length > 0
      ? [{ id: answer.id, values }]
      : [];
  });
  return answers.length === raw.answers.length ? { answers } : null;
}

export function answerLabels(
  question: AskUserQuestion,
  values: string[],
): string {
  const labels = new Map(
    question.choices.map((choice) => [choice.value, choice.label] as const),
  );
  return values.map((value) => labels.get(value) ?? value).join("、");
}
