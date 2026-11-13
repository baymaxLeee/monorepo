import { experimental_codeModeTool as codeModeTool } from "@ai-sdk/code-mode";
import { transformToolPreservingCaller } from "@backend/agent-runtime-ts/manifest";
import type { ToolSet } from "ai";

export const CODE_MODE_TIMEOUT_MS = 90_000;

const CODE_MODE_GUIDANCE = [
  "Use Code Mode for two or more independent public searches or fetches, or when intermediate results need programmatic deduplication, filtering, joining, or reduction before reaching the model.",
  "For one focused query call web_search directly; for one known URL call web_fetch directly.",
  "The isolated QuickJS runtime supports ordinary ECMAScript, Promise, JSON, and regular expressions, but URL, fetch, process, require, module, Buffer, filesystem, WebCrypto, eval, and dynamic Function are not available.",
  "Use only tools from the latest capability catalog for network access, await every tool call, use Promise.all for independent calls, and return compact JSON-serializable results instead of complete source documents.",
].join(" ");

const CODE_MODE_WEB_BATCH_EXAMPLE = `const searches = await Promise.all([
  tools.web_search({ query: "first focused query", max_results: 5 }),
  tools.web_search({ query: "second focused query", max_results: 5 }),
]);
const urls = [...new Set(searches.flatMap(result =>
  result.status === "completed" ? result.data.results.map(item => item.url) : []
))].slice(0, 8);
const pages = await Promise.all(urls.map(url => tools.web_fetch({ url })));
return pages.flatMap(result =>
  result.status === "completed" && result.data.type === "document"
    ? [{ url: result.data.finalUrl, title: result.data.title, excerpt: result.data.content.slice(0, 500) }]
    : []
);`;

const UNAVAILABLE_GLOBALS = new Set([
  "Buffer",
  "Function",
  "URL",
  "crypto",
  "eval",
  "fetch",
  "module",
  "performance",
  "process",
  "require",
]);

class CodeModeGuidanceError extends Error {
  readonly retryable = false;
  readonly source = "code-mode";

  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CodeModeGuidanceError";
  }
}

export function codeModeFailure(error: unknown): unknown {
  if (!(error instanceof Error)) {
    return error;
  }
  const code = "code" in error && typeof error.code === "string" ? error.code : "CODE_MODE_ERROR";
  const details =
    "details" in error && error.details && typeof error.details === "object"
      ? (error.details as Record<string, unknown>)
      : undefined;
  const missingGlobal = /\b([A-Za-z_$][\w$]*) is not defined\b/u.exec(error.message)?.[1];
  if (missingGlobal && UNAVAILABLE_GLOBALS.has(missingGlobal)) {
    return new CodeModeGuidanceError(
      "CODE_MODE_UNAVAILABLE_GLOBAL",
      `${missingGlobal} is not available in the QuickJS runtime. Use ordinary string operations or regular expressions for local parsing, and use only the provided tools for network or system access.`,
      { global: missingGlobal },
    );
  }
  const guidance: Partial<Record<string, string>> = {
    CODE_MODE_TIMEOUT:
      "Reduce the number of sources, run independent calls with Promise.all, or split discovery and document reading into two visible Code Mode calls. Do not repeat identical input.",
    CODE_MODE_CPU_TIMEOUT:
      "Simplify local computation and reduce loops or transformations before issuing a new visible Code Mode call.",
    CODE_MODE_DETACHED_BRIDGE_REQUEST:
      "Await every tool call or include it in an awaited Promise.all before returning from Code Mode.",
    CODE_MODE_BRIDGE_LIMIT:
      "Reduce the number of nested tool calls and filter or batch inputs before issuing a new visible Code Mode call.",
    CODE_MODE_SOURCE_TOO_LARGE:
      "Shorten the generated program and move repeated logic into small local helper functions.",
    CODE_MODE_TOOL_APPROVAL_REQUIRED:
      "This tool requires approval and cannot run inside Code Mode. Call it directly from the primary agent instead.",
    CODE_MODE_TOOL_APPROVAL_DENIED:
      "The nested tool approval was denied. Keep approval-dependent tools on the primary agent's direct-call path.",
  };
  const recovery = guidance[code];
  return recovery ? new CodeModeGuidanceError(code, `${error.message} ${recovery}`, details) : error;
}

export function createAgentCodeModeTool(): ToolSet[string] {
  const base = codeModeTool({
    toolDiscovery: "conversation",
    executionPolicy: { timeoutMs: CODE_MODE_TIMEOUT_MS },
  });
  return transformToolPreservingCaller(base, (definition) => {
    const candidate = definition as ToolSet[string] & {
      description?: string;
      execute?: (input: unknown, options: { abortSignal?: AbortSignal }) => unknown;
      inputExamples?: unknown[];
    };
    const execute = candidate.execute;
    return {
      ...candidate,
      description: `${candidate.description ?? ""}\n\n${CODE_MODE_GUIDANCE}`,
      inputExamples: [...(candidate.inputExamples ?? []), { input: { js: CODE_MODE_WEB_BATCH_EXAMPLE } }],
      ...(execute
        ? {
            execute: async (input: unknown, options: { abortSignal?: AbortSignal }) => {
              try {
                return await execute(input, options);
              } catch (error) {
                options.abortSignal?.throwIfAborted();
                throw codeModeFailure(error);
              }
            },
          }
        : {}),
    } as ToolSet[string];
  });
}
