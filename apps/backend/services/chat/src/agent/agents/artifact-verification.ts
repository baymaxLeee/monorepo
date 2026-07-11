const MAX_REPAIR_ATTEMPTS = 1;

type VerificationFinding = {
  code: string;
  message: string;
  suggestion: string;
  blockId: string;
};

type VerificationItem = {
  documentId: string;
  phase: "verify" | "repair" | "failed";
  repairAttempts: number;
  findings: VerificationFinding[];
  failure?: string;
};

export type ArtifactVerificationState = {
  current?: VerificationItem;
  queuedDocumentIds: string[];
  processedToolCallIds: string[];
};

type ArtifactRepairChange = {
  block_id: string;
  brief: string;
};

export type ArtifactVerificationDirective =
  | {
      toolName: "html_validate";
      toolInput: { file_id: string };
      instruction: string;
    }
  | {
      toolName: "edit_file";
      toolInput: {
        document_id: string;
        brief: string;
        changes: ArtifactRepairChange[];
      };
      instruction: string;
    }
  | {
      toolName: null;
      instruction: string;
    };

export function createArtifactVerificationState(): ArtifactVerificationState {
  return { queuedDocumentIds: [], processedToolCallIds: [] };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function advance(state: ArtifactVerificationState): ArtifactVerificationState {
  const [documentId, ...queuedDocumentIds] = state.queuedDocumentIds;
  return {
    ...state,
    queuedDocumentIds,
    current: documentId
      ? { documentId, phase: "verify", repairAttempts: 0, findings: [] }
      : undefined,
  };
}

function enqueue(state: ArtifactVerificationState, documentId: string): ArtifactVerificationState {
  if (state.current?.documentId === documentId || state.queuedDocumentIds.includes(documentId)) return state;
  if (!state.current) {
    return { ...state, current: { documentId, phase: "verify", repairAttempts: 0, findings: [] } };
  }
  return { ...state, queuedDocumentIds: [...state.queuedDocumentIds, documentId] };
}

function actionableFindings(output: Record<string, unknown>): VerificationFinding[] {
  if (!Array.isArray(output.findings)) return [];
  return output.findings.flatMap((value) => {
    const finding = recordValue(value);
    if (
      !finding || finding.actionable !== true || typeof finding.code !== "string" ||
      typeof finding.message !== "string" || typeof finding.suggestion !== "string" ||
      typeof finding.block_id !== "string"
    ) return [];
    return [{ code: finding.code, message: finding.message, suggestion: finding.suggestion, blockId: finding.block_id }];
  });
}

function applyToolResult(
  state: ArtifactVerificationState,
  toolName: string,
  outputValue: unknown,
): ArtifactVerificationState {
  const output = recordValue(outputValue);
  if (!output) return state;
  if (toolName === "write_file" || toolName === "edit_file") {
    if (output.ok !== true || output.status !== "completed" || output.kind !== "html" || typeof output.document_id !== "string") return state;
    if (toolName === "edit_file" && state.current?.documentId === output.document_id && state.current.phase === "repair") {
      return {
        ...state,
        current: { ...state.current, phase: "verify", repairAttempts: state.current.repairAttempts + 1, findings: [] },
      };
    }
    return enqueue(state, output.document_id);
  }
  if (toolName !== "html_validate" || !state.current) return state;
  if (output.status !== "completed" || output.file_id !== state.current.documentId) {
    return { ...state, current: { ...state.current, phase: "failed", failure: "html_validate did not complete for the expected revision" } };
  }
  const unaddressable = Array.isArray(output.findings) && output.findings.some((value) => {
    const finding = recordValue(value);
    return finding?.actionable === true && typeof finding.block_id !== "string";
  });
  if (unaddressable) {
    return { ...state, current: { ...state.current, phase: "failed", failure: "validation found a document-level issue that cannot be repaired by block" } };
  }
  const findings = actionableFindings(output);
  if (findings.length === 0) return advance(state);
  if (state.current.repairAttempts >= MAX_REPAIR_ATTEMPTS) {
    return { ...state, current: { ...state.current, phase: "failed", findings, failure: "HTML still has actionable findings after the focused repair" } };
  }
  return { ...state, current: { ...state.current, phase: "repair", findings } };
}

export function reduceArtifactVerificationSteps(
  initial: ArtifactVerificationState,
  steps: ReadonlyArray<{ content: ReadonlyArray<unknown> }>,
): ArtifactVerificationState {
  let state = initial;
  const processed = new Set(initial.processedToolCallIds);
  for (const step of steps) {
    for (const raw of step.content) {
      const part = recordValue(raw);
      if (!part || typeof part.toolCallId !== "string" || processed.has(part.toolCallId)) continue;
      if (part.type === "tool-result" && typeof part.toolName === "string") {
        state = applyToolResult(state, part.toolName, part.output);
        processed.add(part.toolCallId);
      } else if (part.type === "tool-error" && typeof part.toolName === "string") {
        processed.add(part.toolCallId);
        if (state.current && ["html_validate", "edit_file"].includes(part.toolName)) {
          state = { ...state, current: { ...state.current, phase: "failed", failure: `${part.toolName} failed` } };
        }
      }
    }
  }
  return { ...state, processedToolCallIds: [...processed] };
}

export function artifactVerificationDirective(state: ArtifactVerificationState): ArtifactVerificationDirective | null {
  const item = state.current;
  if (!item) return null;
  if (item.phase === "verify") {
    return {
      toolName: "html_validate",
      toolInput: { file_id: item.documentId },
      instruction: `Quality gate: call html_validate now with file_id="${item.documentId}". Do not answer the user before validation completes.`,
    };
  }
  if (item.phase === "failed") {
    return {
      toolName: null,
      instruction: `The mandatory HTML quality gate failed for artifact "${item.documentId}": ${item.failure}. Do not claim successful delivery. Briefly report that the artifact exists but did not pass validation.`,
    };
  }
  const changes = new Map<string, string[]>();
  for (const finding of item.findings) {
    const values = changes.get(finding.blockId) ?? [];
    values.push(`${finding.code}: ${finding.message} Fix: ${finding.suggestion}`);
    changes.set(finding.blockId, values);
  }
  const repairChanges = [...changes].map(([block_id, values]) => ({
    block_id,
    brief: values.join(" "),
  }));
  const repairBrief =
    "Apply only the specified block-scoped validation fixes and preserve every other block byte-for-byte.";
  return {
    toolName: "edit_file",
    toolInput: {
      document_id: item.documentId,
      brief: repairBrief,
      changes: repairChanges,
    },
    instruction:
      `Quality gate: call edit_file for document_id="${item.documentId}" with changes=${JSON.stringify(repairChanges)}. ` +
      `${repairBrief} Do not answer before revalidation.`,
  };
}
