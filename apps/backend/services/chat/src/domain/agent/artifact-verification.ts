type VerificationFinding = {
  code: string;
  reason: string;
  evidence?: string;
  suggestion: string;
  blockId: string;
};

export type ArtifactVerificationPhase =
  | "verify"
  | "repair"
  | "completed"
  | "failed"
  | "no_progress"
  | "incomplete_budget";

export type VerificationItem = {
  documentId: string;
  phase: ArtifactVerificationPhase;
  findings: VerificationFinding[];
  seenFingerprints: string[];
  failure?: string;
};

export type ArtifactVerificationState = {
  items: VerificationItem[];
};

export type ArtifactVerificationEvent = {
  toolCallId: string;
  toolName: string;
  input?: unknown;
  outcome:
    | { kind: "completed"; data: unknown }
    | { kind: "failed"; message: string };
};

type ArtifactRepairChange = {
  block_id: string;
  brief: string;
};

export type ArtifactVerificationDirective =
  | {
      toolName: "validate_html";
      toolInputs: Array<{ file_id: string }>;
      instruction: string;
    }
  | {
      toolName: "edit_file";
      toolInputs: Array<{
        document_id: string;
        brief: string;
        changes: ArtifactRepairChange[];
      }>;
      instruction: string;
    }
  | {
      toolName: null;
      toolInputs: [];
      instruction: string;
    };

export function createArtifactVerificationState(): ArtifactVerificationState {
  return { items: [] };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isAddressableBlockId(value: unknown): value is string {
  return typeof value === "string" && /^page-[1-9]\d*$/.test(value);
}

function actionableFindings(output: Record<string, unknown>): VerificationFinding[] {
  if (!Array.isArray(output.errors)) return [];
  return output.errors.flatMap((value) => {
    const finding = recordValue(value);
    if (
      !finding ||
      typeof finding.code !== "string" ||
      typeof finding.reason !== "string" ||
      typeof finding.suggestion !== "string" ||
      !isAddressableBlockId(finding.block_id)
    ) {
      return [];
    }
    return [
      {
        code: finding.code,
        reason: finding.reason,
        ...(typeof finding.evidence === "string" ? { evidence: finding.evidence } : {}),
        suggestion: finding.suggestion,
        blockId: finding.block_id,
      },
    ];
  });
}

export function validationFingerprint(findings: readonly VerificationFinding[]): string {
  return [...new Set(findings.map((finding) => `${finding.blockId}\u0000${finding.code}`))]
    .sort()
    .join("\u0001");
}

function replaceItem(
  state: ArtifactVerificationState,
  documentId: string,
  update: (item: VerificationItem) => VerificationItem,
): ArtifactVerificationState {
  return {
    items: state.items.map((item) =>
      item.documentId === documentId ? update(item) : item,
    ),
  };
}

function startVerification(
  state: ArtifactVerificationState,
  documentId: string,
  preserveFingerprints: boolean,
): ArtifactVerificationState {
  const existing = state.items.find((item) => item.documentId === documentId);
  if (!existing) {
    return {
      items: [
        ...state.items,
        {
          documentId,
          phase: "verify",
          findings: [],
          seenFingerprints: [],
        },
      ],
    };
  }
  return replaceItem(state, documentId, (item) => ({
    ...item,
    phase: "verify",
    findings: [],
    seenFingerprints: preserveFingerprints ? item.seenFingerprints : [],
    failure: undefined,
  }));
}

function documentIdFromInput(input: unknown, key: "file_id" | "document_id"): string | null {
  const value = recordValue(input)?.[key];
  return typeof value === "string" && value ? value : null;
}

function applyFailure(
  state: ArtifactVerificationState,
  event: ArtifactVerificationEvent,
): ArtifactVerificationState {
  const documentId =
    event.toolName === "validate_html"
      ? documentIdFromInput(event.input, "file_id")
      : event.toolName === "edit_file"
        ? documentIdFromInput(event.input, "document_id")
        : null;
  if (!documentId) return state;
  const item = state.items.find((candidate) => candidate.documentId === documentId);
  if (!item) return state;
  if (
    (event.toolName === "validate_html" && item.phase !== "verify") ||
    (event.toolName === "edit_file" && item.phase !== "repair")
  ) {
    return state;
  }
  return replaceItem(state, documentId, (current) => ({
    ...current,
    phase: "failed",
    failure: event.outcome.kind === "failed" ? event.outcome.message : "quality gate failed",
  }));
}

function applyEvent(
  state: ArtifactVerificationState,
  event: ArtifactVerificationEvent,
): ArtifactVerificationState {
  if (event.outcome.kind === "failed") return applyFailure(state, event);
  const output = recordValue(event.outcome.data);
  if (!output) return state;

  if (event.toolName === "write_file" || event.toolName === "edit_file") {
    const expectedDocumentId = documentIdFromInput(event.input, "document_id");
    const expectedItem = expectedDocumentId
      ? state.items.find((item) => item.documentId === expectedDocumentId)
      : undefined;
    if (output.kind !== "html" || typeof output.document_id !== "string") {
      return event.toolName === "edit_file" ? applyFailure(state, event) : state;
    }
    if (
      event.toolName === "edit_file" &&
      expectedItem?.phase === "repair" &&
      output.document_id !== expectedDocumentId
    ) {
      return replaceItem(state, expectedItem.documentId, (current) => ({
        ...current,
        phase: "failed",
        failure: "edit_file returned a different artifact during deterministic repair",
      }));
    }
    const current = state.items.find((item) => item.documentId === output.document_id);
    return startVerification(
      state,
      output.document_id,
      event.toolName === "edit_file" && current?.phase === "repair",
    );
  }

  if (event.toolName !== "validate_html") return state;
  const expectedDocumentId = documentIdFromInput(event.input, "file_id");
  const documentId = typeof output.file_id === "string" ? output.file_id : null;
  if (!documentId || (expectedDocumentId && documentId !== expectedDocumentId)) {
    if (!expectedDocumentId) return applyFailure(state, event);
    return replaceItem(state, expectedDocumentId, (current) => ({
      ...current,
      phase: "failed",
      failure: "validate_html returned a result for a different artifact",
    }));
  }
  const item = state.items.find((candidate) => candidate.documentId === documentId);
  if (!item || item.phase !== "verify") return state;
  const unaddressable =
    Array.isArray(output.errors) &&
    output.errors.some((value) => !isAddressableBlockId(recordValue(value)?.block_id));
  if (unaddressable) {
    return replaceItem(state, documentId, (current) => ({
      ...current,
      phase: "failed",
      failure: "validation found a document-level issue that cannot be repaired by block",
    }));
  }
  const findings = actionableFindings(output);
  if (findings.length === 0) {
    return replaceItem(state, documentId, (current) => ({
      ...current,
      phase: "completed",
      findings: [],
    }));
  }
  const fingerprint = validationFingerprint(findings);
  if (item.seenFingerprints.includes(fingerprint)) {
    return replaceItem(state, documentId, (current) => ({
      ...current,
      phase: "no_progress",
      findings,
      failure: "deterministic validation repeated a previously seen error fingerprint",
    }));
  }
  return replaceItem(state, documentId, (current) => ({
    ...current,
    phase: "repair",
    findings,
    seenFingerprints: [...current.seenFingerprints, fingerprint],
  }));
}

export function reduceArtifactVerificationEvents(
  initial: ArtifactVerificationState,
  events: ReadonlyArray<ArtifactVerificationEvent>,
): ArtifactVerificationState {
  let state = initial;
  const processed = new Set<string>();
  for (const event of events) {
    if (processed.has(event.toolCallId)) continue;
    processed.add(event.toolCallId);
    state = applyEvent(state, event);
  }
  return state;
}

export function markArtifactVerificationBudgetExhausted(
  state: ArtifactVerificationState,
): ArtifactVerificationState {
  return {
    items: state.items.map((item) =>
      item.phase === "verify" || item.phase === "repair"
        ? {
            ...item,
            phase: "incomplete_budget" as const,
            failure: "the run reached its step budget before validation completed",
          }
        : item,
    ),
  };
}

function repairChanges(item: VerificationItem): ArtifactRepairChange[] {
  const changes = new Map<string, string[]>();
  for (const finding of item.findings) {
    const values = changes.get(finding.blockId) ?? [];
    values.push(
      `${finding.code}: ${finding.reason}` +
        `${finding.evidence ? ` Evidence: ${finding.evidence}` : ""}` +
        ` Fix: ${finding.suggestion}`,
    );
    changes.set(finding.blockId, values);
  }
  return [...changes].map(([block_id, values]) => ({
    block_id,
    brief: values.join(" "),
  }));
}

export function artifactVerificationDirective(
  state: ArtifactVerificationState,
): ArtifactVerificationDirective | null {
  const verifying = state.items.filter((item) => item.phase === "verify");
  if (verifying.length > 0) {
    return {
      toolName: "validate_html",
      toolInputs: verifying.map((item) => ({ file_id: item.documentId })),
      instruction: "Validate every pending HTML artifact in this exact batch before continuing.",
    };
  }
  const repairing = state.items.filter((item) => item.phase === "repair");
  if (repairing.length > 0) {
    const brief =
      "Apply only the specified block-scoped validation fixes and preserve every other block byte-for-byte.";
    return {
      toolName: "edit_file",
      toolInputs: repairing.map((item) => ({
        document_id: item.documentId,
        brief,
        changes: repairChanges(item),
      })),
      instruction: "Apply the deterministic block-scoped repairs in this exact batch, then revalidate.",
    };
  }
  const incomplete = state.items.filter(
    (item) =>
      item.phase === "failed" ||
      item.phase === "no_progress" ||
      item.phase === "incomplete_budget",
  );
  if (incomplete.length === 0) return null;
  return {
    toolName: null,
    toolInputs: [],
    instruction:
      "The following artifacts exist but did not pass the mandatory HTML quality gate: " +
      incomplete
        .map((item) => `\"${item.documentId}\" (${item.phase}: ${item.failure ?? "unknown failure"})`)
        .join(", ") +
      ". Do not claim successful validation; report this briefly and accurately.",
  };
}
