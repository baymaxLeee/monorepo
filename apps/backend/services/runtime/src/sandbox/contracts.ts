import { z } from "zod";

const identity = z.string().min(1).max(128);
const fileSystemEntrySchema = z
  .object({ path: z.string().min(1).max(4096), access: z.enum(["read", "write", "deny"]) })
  .strict();
const networkPolicySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("restricted"), allowed_hosts: z.array(z.string().min(1).max(253)).max(32) }).strict(),
  z.object({ type: z.literal("enabled") }).strict(),
]);
export const permissionProfileSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("managed"),
      file_system: z.discriminatedUnion("type", [
        z.object({ type: z.literal("restricted"), entries: z.array(fileSystemEntrySchema).max(64) }).strict(),
        z.object({ type: z.literal("unrestricted") }).strict(),
      ]),
      network: networkPolicySchema,
    })
    .strict(),
  z.object({ type: z.literal("disabled") }).strict(),
  z.object({ type: z.literal("external"), network: networkPolicySchema }).strict(),
]);
const processIdentitySchema = z.object({ process_id: z.number().int().positive(), entry_id: identity }).strict();
export const sandboxAttemptSchema = z
  .object({
    attempt: z.union([z.literal(1), z.literal(2)]),
    sandboxed: z.boolean(),
    permission_profile: permissionProfileSchema,
    process: processIdentitySchema,
  })
  .strict();
export const sandboxViolationSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("file-system"), operation: z.enum(["read", "write"]), path: z.string().min(1).max(4096) })
    .strict(),
  z
    .object({
      type: z.literal("network"),
      host: z.string().min(1).max(253),
      port: z.number().int().min(1).max(65535),
      protocol: z.enum(["http", "https", "tcp"]),
    })
    .strict(),
]);
const processTerminationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("exit"), exit_code: z.number().int() }).strict(),
  z.object({ type: z.literal("timeout"), timeout_ms: z.number().int().positive() }).strict(),
  z.object({ type: z.literal("start-error"), message: z.string().min(1).max(4096) }).strict(),
  z.object({ type: z.literal("sandbox-unavailable"), message: z.string().min(1).max(4096) }).strict(),
  z.object({ type: z.literal("sandbox-violation"), violation: sandboxViolationSchema }).strict(),
]);
export const scopeSchema = z
  .object({
    tenant_id: identity,
    workspace_id: identity,
    user_id: identity,
    conversation_id: identity,
    run_id: identity,
    attempt_epoch: z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .max(20),
  })
  .strict();
export type Scope = z.infer<typeof scopeSchema>;
export const startSchema = z
  .object({
    scope: scopeSchema,
    request_id: identity,
    sandbox: sandboxAttemptSchema,
    violation_hint: sandboxViolationSchema.optional(),
    command: z.string().min(1).max(65536),
    workdir: z.string().max(1024).default("/workspace/work"),
    env: z
      .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().max(4096))
      .refine((value) => Object.keys(value).length <= 64, "too many environment variables")
      .optional(),
    tty: z.boolean().default(false),
    yield_time_ms: z.number().int().min(0).max(10000).default(1000),
    timeout_ms: z.number().int().positive().default(120000),
  })
  .strict();
export const continueSchema = z
  .object({
    scope: scopeSchema,
    request_id: identity,
    chars: z.string().max(65536).default(""),
    stdout_offset: z.number().int().nonnegative().default(0),
    stderr_offset: z.number().int().nonnegative().default(0),
    yield_time_ms: z.number().int().min(0).max(10000).default(1000),
  })
  .strict();
export const processSchema = z.object({
  session_id: z.string(),
  stdout: z.string(),
  stderr: z.string(),
  termination: processTerminationSchema.nullable(),
  stdout_offset: z.number(),
  stderr_offset: z.number(),
  truncated: z.boolean(),
});
export const sessionSchema = z.object({ id: z.string(), workdir: z.string(), expires_at: z.string() });
export const workspaceSnapshotSchema = z.object({
  files: z.array(
    z.object({
      path: z.string().min(1).max(1024),
      size: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ),
});
export const workspaceEditSchema = z.object({ token: identity });
export type WorkspaceEdit = z.infer<typeof workspaceEditSchema>;
export type ProcessResult = z.infer<typeof processSchema>;

export function filePath(value: string): string {
  if (
    !value ||
    value.length > 1024 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((part) => !part || part === "." || part === ".." || /[\x00-\x1f]/.test(part))
  ) {
    throw new Error("invalid workspace-relative file path");
  }
  return value;
}
