import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { assertPluginId } from "@repo/agent-runtime/plugins/identity";
import { discoverInstalledMcpServer } from "@repo/agent-runtime/plugins/mcp";
import { resolveTurnPluginSnapshot } from "@repo/agent-runtime/plugins/snapshot";
import type {
  AgentPluginManifest,
  McpConnectionGrant,
  PersistedTurnPluginSnapshot,
  PluginActivation,
  ResolvedTurnPluginSnapshot,
} from "@repo/agent-runtime/plugins/types";
import type { SkillSourceEntry } from "@repo/agent-runtime/tools/skills";
import { parse } from "yaml";
import { z } from "zod";

import type { LocalPluginActivation } from "../../contracts/bridge.generated";

const portableSchemaUri = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const platformFields = z.object({
  interface: z.object({ displayName: z.string().optional() }).optional(),
  hooks: z.never().optional(),
  apps: z.never().optional(),
  onboardingSkill: z.never().optional(),
});
const manifestSchema = platformFields.extend({
  name: z.string().min(1),
  version: z.string().optional(),
  description: z.string().optional(),
  skills: z.union([z.string(), z.array(z.string())]).optional(),
  mcpServers: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
});
const skillMetadata = z.object({ name: z.string().trim().min(1).max(64), description: z.string().trim().min(1) });
const serverConfig = z.strictObject({
  type: z.literal("http").optional(),
  url: z.url(),
  http_headers: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
});
const serverMap = z.record(z.string().regex(/^[a-z0-9][a-z0-9_-]*$/), serverConfig);
const digest = (data: string) => createHash("sha256").update(data).digest("hex");

function inside(root: string, path: string) {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function resource(root: string, path: string, optional = false) {
  if (isAbsolute(path) || !inside(root, resolve(root, path))) throw new Error("插件资源超出安装目录");
  let resolved: string;
  try {
    resolved = await realpath(join(root, path));
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!inside(root, resolved)) throw new Error("插件资源超出安装目录");
  return resolved;
}

async function readManifest(root: string) {
  const portablePath = await resource(root, "plugin.json", true);
  const portable = portablePath ? JSON.parse(await readFile(portablePath, "utf8")) : null;
  const isPortable =
    typeof portable?.$schema === "string" && portable.$schema.startsWith("https://agent-plugins.org/schemas/");
  if (isPortable && portable.$schema !== portableSchemaUri) throw new Error("不支持此 Agent Plugins schema 版本");
  const extension = portable?.extensions?.["com.openai"];
  const inline = isPortable && extension && typeof extension === "object" && !Array.isArray(extension);
  const overlayPath = inline ? null : await resource(root, ".codex-plugin/plugin.json", isPortable);
  const overlay = overlayPath ? JSON.parse(await readFile(overlayPath, "utf8")) : {};
  // Codex portable packages have fixed component paths. Only presentation and
  // OpenAI-specific fields come from the inline extension or the legacy overlay.
  const manifest = isPortable
    ? manifestSchema.parse({
        name: portable.name,
        version: portable.version,
        description: portable.description,
        ...platformFields.parse(inline ? extension : overlay),
      })
    : manifestSchema.parse(overlay);
  assertPluginId(`${manifest.name}@local`);
  for (const path of ["hooks/hooks.json", ".app.json"]) {
    if (await resource(root, path, true)) throw new Error("本地插件暂不支持 Hooks 或 Apps");
  }
  return { ...manifest, defaultMcpFile: isPortable ? "mcp.json" : ".mcp.json" };
}

export async function importLocalPlugin(directory: string, selected: string) {
  const source = await realpath(selected);
  const manifest = await readManifest(source);
  const plugins = await installationDirectory(directory);
  if (inside(source, plugins)) throw new Error("插件源目录包含安装目录");
  const staging = await mkdtemp(join(plugins, ".install-"));
  try {
    const staged = join(staging, manifest.name);
    await cp(source, staged, {
      recursive: true,
      force: false,
      errorOnExist: true,
      filter: async (path) => {
        const info = await lstat(path);
        if (!info.isDirectory() && !info.isFile()) throw new Error("插件包只能包含普通文件和目录");
        return true;
      },
    });
    const copied = await readManifest(staged);
    if (copied.name !== manifest.name) throw new Error("导入期间插件标识发生变化");
    await readContributions(staged, copied);
    await rename(staged, join(plugins, manifest.name));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return { pluginId: `${manifest.name}@local`, displayName: manifest.interface?.displayName || manifest.name };
}

async function installationDirectory(directory: string) {
  const root = join(directory, "plugins");
  await mkdir(root, { recursive: true, mode: 0o700 });
  return realpath(root);
}

export async function listLocalPlugins(directory: string) {
  const root = await installationDirectory(directory);
  const installed = [];
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const manifest = await readManifest(join(root, entry.name));
    if (entry.name !== manifest.name) throw new Error("本地插件目录与插件名不一致");
    installed.push({
      pluginId: `${manifest.name}@local`,
      displayName: manifest.interface?.displayName || manifest.name,
    });
  }
  return installed;
}

async function skillReferences(skillRoot: string) {
  const files = new Map<string, string>();
  const references = await resource(skillRoot, "references", true);
  async function visit(path: string) {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) {
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(file)) hash.update(chunk);
        files.set(relative(skillRoot, file), hash.digest("hex"));
      } else throw new Error("Skill 引用资源必须是普通文件");
    }
  }
  if (references) await visit(references);
  return files;
}

async function loadSkills(root: string, paths: string[], defaultPath: boolean, pluginId: string) {
  const bodies = new Map<string, SkillSourceEntry>();
  const skills: NonNullable<AgentPluginManifest["skills"]>[number][] = [];
  for (const path of paths) {
    const dir = await resource(root, path, defaultPath);
    if (!dir) continue;
    const direct = await resource(root, join(path, "SKILL.md"), true);
    const children = direct
      ? [path]
      : (await readdir(dir, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => join(path, entry.name))
          .sort();
    for (const child of children) {
      const file = await resource(root, join(child, "SKILL.md"), true);
      if (!file) continue;
      const body = await readFile(file, "utf8");
      const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(body);
      if (!header) throw new Error("插件 SKILL.md 缺少 frontmatter");
      const { name, description } = skillMetadata.parse(parse(header[1]!));
      const hash = digest(body);
      const qualified = `${pluginId}:${name}`;
      if (bodies.has(qualified)) throw new Error(`重复的插件 Skill ${qualified}`);
      const skillRoot = await resource(root, child);
      const references = await skillReferences(skillRoot!);
      bodies.set(qualified, {
        id: qualified,
        name: qualified,
        description,
        loadBody: async () => body.slice(header[0].length),
        ...(references.size
          ? {
              loadFile: async (path: string) => {
                const expected = references.get(path);
                if (!expected) throw new Error("该资源不在已启用 Skill 的 references 目录中");
                const file = await resource(skillRoot!, path);
                const content = await readFile(file!);
                if (createHash("sha256").update(content).digest("hex") !== expected)
                  throw new Error("Skill 引用资源已变更");
                return {
                  storageKind: "inline" as const,
                  mimeType: "text/plain",
                  content: new TextDecoder("utf-8", { fatal: true }).decode(content),
                };
              },
            }
          : {}),
      });
      skills.push({
        name,
        description,
        id: name,
        assetId: qualified,
        revisionId: digest(JSON.stringify([hash, ...references])),
        sha256: hash,
      });
    }
  }
  return { skills, bodies };
}

async function readContributions(root: string, manifest: Awaited<ReturnType<typeof readManifest>>) {
  const paths = manifest.skills ?? "./skills";
  const { skills, bodies } = await loadSkills(
    root,
    Array.isArray(paths) ? paths : [paths],
    manifest.skills === undefined,
    `${manifest.name}@local`,
  );
  const config = manifest.mcpServers ?? manifest.defaultMcpFile;
  let declarations: unknown = config;
  if (typeof config === "string") {
    const file = await resource(root, config, manifest.mcpServers === undefined);
    declarations = file ? JSON.parse(await readFile(file, "utf8")) : {};
  }
  const servers = serverMap.parse(
    declarations && typeof declarations === "object" && "mcpServers" in declarations
      ? declarations.mcpServers
      : declarations,
  );
  for (const server of Object.values(servers)) {
    const url = new URL(server.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || url.search)
      throw new Error("MCP 服务需要固定的 HTTP(S) 地址");
  }
  if (!skills.length && !Object.keys(servers).length)
    throw new Error(`本地插件 ${manifest.name} 没有可加载的 Skills 或 HTTP MCP 服务`);
  return { skills, bodies, servers };
}

async function readInstalledPlugin(
  directory: string,
  activation: PluginActivation,
  signal: AbortSignal,
  frozen?: AgentPluginManifest,
) {
  const id = activation.pluginId;
  assertPluginId(id);
  if (!id.endsWith("@local") || Object.keys(activation.bindings ?? {}).length) throw new Error("本地插件选择无效");
  const plugins = join(directory, "plugins");
  const root = await resource(await realpath(plugins), id.slice(0, -"@local".length));
  const manifest = await readManifest(root!);
  if (id !== `${manifest.name}@local`) throw new Error("本地插件身份不匹配");
  const { skills, bodies, servers } = await readContributions(root!, manifest);
  if (
    frozen &&
    (frozen.mcpServers.length !== Object.keys(servers).length ||
      frozen.mcpServers.some((server) => servers[server.name]?.url !== server.url))
  ) {
    throw new Error("插件配置已变更，请开始新一轮会话以使用最新配置");
  }
  const grants: McpConnectionGrant[] = [];
  const mcpServers = [];
  for (const [name, server] of Object.entries(servers).sort(([a], [b]) => a.localeCompare(b))) {
    const headers = { ...server.http_headers, ...server.headers };
    mcpServers.push(await discoverInstalledMcpServer(name, server.url, headers, signal));
    grants.push({ pluginId: id, serverName: name, headers });
  }
  const release = {
    schemaVersion: 1,
    id,
    version: manifest.version ?? "local",
    displayName: manifest.interface?.displayName || manifest.name,
    description: manifest.description || manifest.name,
    source: "local",
    trust: "unverified",
    mcpServers,
    skills,
  } as const;
  return {
    resolved: { manifest: { ...release, digest: `sha256:${digest(JSON.stringify(release))}` }, activation },
    bodies,
    grants,
  };
}

export async function resolveDesktopPlugins(
  directory: string,
  frozen: PersistedTurnPluginSnapshot | null,
  activations: LocalPluginActivation[],
  resolvePlatform: (selection: readonly PluginActivation[], signal: AbortSignal) => Promise<ResolvedTurnPluginSnapshot>,
  signal: AbortSignal,
) {
  const localIds = new Set(
    frozen
      ? frozen.plugins.filter((p) => p.manifest.source === "local").map((p) => p.manifest.id)
      : activations.filter((p) => p.origin === "local").map((p) => p.pluginId),
  );
  const bodies = new Map<string, SkillSourceEntry>();
  if (new Set(activations.map((p) => p.pluginId)).size !== activations.length) throw new Error("重复的插件标识");
  const snapshot = await resolveTurnPluginSnapshot(frozen, activations, async (selection) => {
    const platform = await resolvePlatform(
      selection.filter((p) => !localIds.has(p.pluginId)),
      signal,
    );
    if (platform.plugins.some((p) => p.manifest.source === "local" || localIds.has(p.manifest.id)))
      throw new Error("平台与本地插件来源冲突");
    const plugins = [...platform.plugins];
    const connectionGrants = [...platform.connectionGrants];
    for (const p of selection.filter((p) => localIds.has(p.pluginId))) {
      signal.throwIfAborted();
      const installed = await readInstalledPlugin(
        directory,
        { pluginId: p.pluginId, ...(p.bindings ? { bindings: p.bindings } : {}) },
        signal,
        frozen?.plugins.find((plugin) => plugin.manifest.id === p.pluginId)?.manifest,
      );
      plugins.push(installed.resolved);
      connectionGrants.push(...installed.grants);
      for (const [name, skill] of installed.bodies) bodies.set(name, skill);
    }
    if (!localIds.size) return platform;
    const snapshotDigest = `sha256:${digest(JSON.stringify([platform.snapshotDigest, ...plugins.map((p) => p.manifest.digest)]))}`;
    return { ...platform, plugins, connectionGrants, snapshotDigest };
  });
  return { snapshot, bodies };
}
