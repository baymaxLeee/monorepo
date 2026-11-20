import { INSTRUCTION_SECTION_TAGS } from "../instructions/section-tags.js";
import { escapeXmlText, xmlSection } from "../instructions/xml.js";

export type NetworkAccess = "disabled" | "restricted" | "environment" | "public";

/**
 * Immutable behavioral facts about the host selected for this thread. The model sees this
 * shape, while transport details such as proxy sockets, containers and IPC stay
 * behind the host boundary.
 */
export interface ExecutionEnvironment {
  location: "local" | "cloud";
  workspace: {
    root: string;
    access: "read-write";
    isolation: "direct" | "ephemeral";
    persistence: "host" | "session";
    externalSources: "unavailable" | "read-only";
  };
  network: {
    access: NetworkAccess;
    protocols: Array<"http" | "https">;
  };
  process: {
    shell: true;
    lifetime: "command" | "turn";
    backgroundServices: "unsupported" | "turn-scoped";
  };
  deliverables: "workspace-reference" | "session-file";
  permissions: {
    profileId: string;
    enforcement: "managed" | "disabled" | "external";
    approvalPolicy: "never" | "on-request" | "unless-trusted" | "granular";
  };
}

function assertEnvironment(environment: ExecutionEnvironment): void {
  if (!environment.workspace.root.startsWith("/")) {
    throw new Error("execution environment workspace root must be absolute");
  }
  if (environment.network.access === "disabled" && environment.network.protocols.length > 0) {
    throw new Error("disabled execution environment cannot advertise network protocols");
  }
  if (environment.network.access !== "disabled" && environment.network.protocols.length === 0) {
    throw new Error("networked execution environment must advertise at least one protocol");
  }
}

export function renderExecutionEnvironment(environment: ExecutionEnvironment): string {
  assertEnvironment(environment);
  const body = escapeXmlText(JSON.stringify(environment));
  return xmlSection(INSTRUCTION_SECTION_TAGS.executionEnvironment, body)!;
}

export function attachExecutionEnvironment(instructions: string, environment: ExecutionEnvironment): string {
  const section = renderExecutionEnvironment(environment);
  const existing = /<execution_environment>.*?<\/execution_environment>/s;
  if (existing.test(instructions)) return instructions.replace(existing, section);
  const closing = "</agent_instructions>";
  const index = instructions.lastIndexOf(closing);
  if (index < 0) return `${instructions}\n\n${section}`;
  return `${instructions.slice(0, index)}${section}\n\n${instructions.slice(index)}`;
}
