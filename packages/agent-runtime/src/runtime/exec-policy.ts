import {
  permissionProfileHasDeniedReads,
  type AdditionalPermissionProfile,
  type ApprovalPolicy,
  type PermissionProfile,
  type SandboxPermissions,
} from "./permissions.js";

export type ExecPolicyDecision = "allow" | "prompt" | "prompt-user" | "forbidden";

export interface ExecPolicyRule {
  prefix: string[];
  decision: ExecPolicyDecision;
  reason?: string;
  bypassSandbox?: boolean;
}

export type ExecApprovalRequirement =
  | { type: "skip"; bypassSandbox: boolean; reason: string | null }
  | { type: "needs-approval"; reason: string | null }
  | { type: "needs-human-approval"; reason: string | null }
  | { type: "forbidden"; reason: string };

export interface CanonicalShellCommand {
  argv: string[];
  commands: string[][];
  analyzable: boolean;
}

const BROAD_ALLOW_PROGRAMS = new Set([
  "bash",
  "sh",
  "zsh",
  "fish",
  "env",
  "git",
  "rm",
  "python",
  "python3",
  "node",
  "sudo",
]);
const SHELL_PROGRAMS = new Set(["bash", "sh", "zsh"]);

function isOperatorStart(value: string, index: number): boolean {
  return value[index] === ";" || value[index] === "|" || value[index] === "&" || value[index] === "\n";
}

function lowerShellScript(script: string): { commands: string[][]; analyzable: boolean } {
  const commands: string[][] = [];
  let command: string[] = [];
  let token = "";
  let quote: "single" | "double" | null = null;
  let escaped = false;
  let analyzable = true;
  const flushToken = () => {
    if (token) command.push(token);
    token = "";
  };
  const flushCommand = () => {
    flushToken();
    while (command[0] && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(command[0])) command.shift();
    if (command.length) commands.push(command);
    command = [];
  };

  for (let index = 0; index < script.length; index++) {
    const char = script[index]!;
    if (escaped) {
      token += char;
      escaped = false;
      continue;
    }
    if (quote === "single") {
      if (char === "'") quote = null;
      else token += char;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "'") {
      quote = "single";
      continue;
    }
    if (char === '"') {
      quote = quote === "double" ? null : "double";
      continue;
    }
    if (char === "`" || (char === "$" && ["(", "{"].includes(script[index + 1] ?? ""))) {
      analyzable = false;
    }
    if (char === "$") analyzable = false;
    if (quote === "double") {
      token += char;
      continue;
    }
    if (/\s/u.test(char) && char !== "\n") {
      flushToken();
      continue;
    }
    if (isOperatorStart(script, index)) {
      flushCommand();
      if ((char === "|" || char === "&") && script[index + 1] === char) index++;
      continue;
    }
    token += char;
  }
  if (escaped || quote) analyzable = false;
  flushCommand();
  return { commands, analyzable };
}

export function canonicalizeShellCommand(command: string): CanonicalShellCommand {
  const lowered = lowerShellScript(command);
  return {
    argv: ["/bin/bash", "--noprofile", "--norc", "-c", command],
    commands: lowered.commands,
    analyzable: lowered.analyzable,
  };
}

function matchesPrefix(command: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length <= command.length && prefix.every((part, index) => command[index] === part);
}

function validateRule(rule: ExecPolicyRule): ExecPolicyRule {
  if (rule.prefix.length === 0 || rule.prefix.some((part) => !part || /[\u0000-\u001f]/u.test(part))) {
    throw new Error("exec policy prefix must contain canonical argv tokens");
  }
  if (
    rule.decision === "allow" &&
    ((rule.prefix.length === 1 && BROAD_ALLOW_PROGRAMS.has(rule.prefix[0]!)) ||
      (SHELL_PROGRAMS.has(rule.prefix[0]!) && ["-c", "-lc"].includes(rule.prefix[1] ?? "")))
  ) {
    throw new Error(`exec policy allow prefix is too broad: ${rule.prefix.join(" ")}`);
  }
  return { ...rule, prefix: [...rule.prefix] };
}

function dangerousReason(command: readonly string[]): string | null {
  const program = command[0]?.split("/").at(-1);
  if (!program) return null;
  if (["sudo", "su", "dd", "mkfs", "diskutil", "launchctl", "chown"].includes(program)) {
    return `${program} requires explicit review`;
  }
  if (["kill", "pkill", "killall"].includes(program)) return "process termination requires explicit review";
  if (program === "chmod") return "permission changes require explicit review";
  if (program === "rm") {
    const flags = command
      .slice(1)
      .filter((part) => part.startsWith("-"))
      .join("");
    if (
      flags.includes("r") ||
      flags.includes("R") ||
      flags.includes("f") ||
      command.includes("--recursive") ||
      command.includes("--force")
    ) {
      return "recursive or forced deletion requires explicit review";
    }
  }
  if (program === "git" && command[1] === "reset" && command.includes("--hard"))
    return "git reset --hard requires explicit review";
  if (
    program === "git" &&
    command[1] === "clean" &&
    command.slice(2).some((part) => part.startsWith("-") && /[fdxX]/u.test(part))
  ) {
    return "git clean requires explicit review";
  }
  if (
    program === "git" &&
    command[1] === "push" &&
    command.slice(2).some((part) => part === "--force" || part === "-f" || part.startsWith("--force-with-lease"))
  ) {
    return "forced git push requires explicit review";
  }
  return null;
}

function fallbackDecision(
  command: readonly string[],
  approvalPolicy: ApprovalPolicy,
  permissionProfile: PermissionProfile,
  analyzable: boolean,
): { decision: ExecPolicyDecision; reason: string | null } {
  const reason =
    dangerousReason(command) ??
    (!analyzable && permissionProfile.type === "disabled"
      ? "dynamic shell syntax without sandbox protection requires explicit review"
      : null);
  if (reason) return { decision: approvalPolicy === "never" ? "forbidden" : "prompt", reason };
  if (approvalPolicy === "unless-trusted") return { decision: "prompt", reason: "project is not trusted" };
  return { decision: "allow", reason: null };
}

const DECISION_WEIGHT: Record<ExecPolicyDecision, number> = {
  allow: 0,
  prompt: 1,
  "prompt-user": 2,
  forbidden: 3,
};

export class ExecPolicy {
  private readonly rules: ExecPolicyRule[];

  constructor(rules: readonly ExecPolicyRule[] = []) {
    this.rules = rules.map(validateRule);
  }

  evaluateCommand(command: readonly string[]) {
    const matches = this.rules.filter((rule) => matchesPrefix(command, rule.prefix));
    const matchedRule =
      matches.sort((left, right) => DECISION_WEIGHT[right.decision] - DECISION_WEIGHT[left.decision])[0] ?? null;
    return { decision: matchedRule?.decision ?? ("allow" as const), matchedRule };
  }

  requirement(input: {
    command: string;
    approvalPolicy: ApprovalPolicy;
    permissionProfile: PermissionProfile;
    sandboxPermissions: SandboxPermissions;
    additionalPermissions?: AdditionalPermissionProfile;
  }): ExecApprovalRequirement {
    if (input.sandboxPermissions === "with_additional_permissions" && !input.additionalPermissions) {
      return { type: "forbidden", reason: "with_additional_permissions requires additional_permissions" };
    }
    if (input.sandboxPermissions !== "with_additional_permissions" && input.additionalPermissions) {
      return { type: "forbidden", reason: "additional_permissions requires with_additional_permissions" };
    }
    if (input.sandboxPermissions !== "use_default") {
      return input.approvalPolicy === "never"
        ? { type: "forbidden", reason: "approval policy forbids sandbox permission escalation" }
        : { type: "needs-approval", reason: "command requests additional sandbox authority" };
    }

    const canonical = canonicalizeShellCommand(input.command);
    const commands = canonical.commands.length ? canonical.commands : [canonical.argv];
    let selected: { decision: ExecPolicyDecision; reason: string | null; rule: ExecPolicyRule | null } = {
      decision: "allow",
      reason: null,
      rule: null,
    };
    let everyCommandExplicitlyAllowed = canonical.analyzable;
    for (const command of commands) {
      const evaluation = this.evaluateCommand(command);
      const fallback = fallbackDecision(command, input.approvalPolicy, input.permissionProfile, canonical.analyzable);
      const candidate = evaluation.matchedRule
        ? { decision: evaluation.decision, reason: evaluation.matchedRule.reason ?? null, rule: evaluation.matchedRule }
        : { ...fallback, rule: null };
      everyCommandExplicitlyAllowed &&= candidate.rule?.decision === "allow";
      if (DECISION_WEIGHT[candidate.decision] > DECISION_WEIGHT[selected.decision]) selected = candidate;
    }

    switch (selected.decision) {
      case "forbidden":
        return { type: "forbidden", reason: selected.reason ?? "command is forbidden by exec policy" };
      case "prompt-user":
        return { type: "needs-human-approval", reason: selected.reason };
      case "prompt":
        return input.approvalPolicy === "never"
          ? { type: "forbidden", reason: selected.reason ?? "approval policy forbids this command" }
          : { type: "needs-approval", reason: selected.reason };
      case "allow": {
        const bypassRequested =
          everyCommandExplicitlyAllowed &&
          commands.every((command) => {
            const rule = this.evaluateCommand(command).matchedRule;
            return rule?.decision === "allow" && rule.bypassSandbox === true;
          });
        return {
          type: "skip",
          bypassSandbox: bypassRequested && !permissionProfileHasDeniedReads(input.permissionProfile),
          reason: null,
        };
      }
    }
  }
}
