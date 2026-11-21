import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { toPersistedTurnPluginSnapshot, type ResolvedTurnPluginSnapshot } from "@repo/agent-runtime";
import { afterEach, expect, it, vi } from "vitest";

import { importLocalPlugin, listLocalPlugins, resolveDesktopPlugins } from "../electron/runtime/local-plugins";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const activation = { origin: "local" as const, pluginId: "writer@local" };
const empty: ResolvedTurnPluginSnapshot = {
  schemaVersion: 1,
  snapshotId: "platform",
  snapshotDigest: `sha256:${"0".repeat(64)}`,
  workspaceRevision: 1,
  tenantId: "tenant",
  workspaceId: "workspace",
  resolvedAt: "2026-01-01T00:00:00Z",
  plugins: [],
  connectionGrants: [],
};
const signal = new AbortController().signal;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "plugin-install-"));
  roots.push(root);
  const source = join(root, "source");
  const state = join(root, "state");
  await mkdir(source);
  await writeFile(
    join(source, "plugin.json"),
    JSON.stringify({
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: "writer",
      extensions: { "com.openai": { interface: { displayName: "Writer" } } },
    }),
  );
  return { source, state };
}

it("imports a portable package atomically, isolates accounts and pins skill references across resume", async () => {
  const { source, state } = await fixture();
  const skill = join(source, "skills", "edit");
  await mkdir(join(skill, "references"), { recursive: true });
  await writeFile(
    join(skill, "SKILL.md"),
    "---\nname: edit\ndescription: Editing guide\n---\nRead references/style.md",
  );
  await writeFile(join(skill, "references/style.md"), "Use plain language.");
  const installed = { pluginId: "writer@local", displayName: "Writer" };
  await expect(importLocalPlugin(state, source)).resolves.toEqual(installed);
  await expect(importLocalPlugin(state, source)).rejects.toThrow();
  expect(await listLocalPlugins(state)).toEqual([installed]);
  expect(await listLocalPlugins(join(state, "another-scope"))).toEqual([]);
  const resolvePlatform = vi.fn(async () => empty);
  expect((await resolveDesktopPlugins(state, null, [], resolvePlatform, signal)).bodies.size).toBe(0);
  const { snapshot, bodies } = await resolveDesktopPlugins(state, null, [activation], resolvePlatform, signal);
  const read = bodies.get("writer@local:edit")!.loadFile!;
  expect(await read("references/style.md")).toMatchObject({ content: "Use plain language." });
  await expect(read("../../plugin.json")).rejects.toThrow();
  const frozen = toPersistedTurnPluginSnapshot(snapshot);
  await expect(resolveDesktopPlugins(state, frozen, [], resolvePlatform, signal)).resolves.toMatchObject({ snapshot });
  await writeFile(join(state, "plugins/writer/skills/edit/references/style.md"), "Drift");
  await expect(read("references/style.md")).rejects.toThrow("已变更");
  await expect(resolveDesktopPlugins(state, frozen, [], resolvePlatform, signal)).rejects.toThrow("已变更");
  expect(JSON.stringify(resolvePlatform.mock.calls)).not.toContain("writer");
});

it("rejects unsupported executable contributions and symlinks without publishing a partial install", async () => {
  const { source, state } = await fixture();
  await writeFile(join(source, "mcp.json"), JSON.stringify({ mcpServers: { local: { command: "example" } } }));
  await expect(importLocalPlugin(state, source)).rejects.toThrow();
  await symlink(join(source, "plugin.json"), join(source, "linked"));
  await expect(importLocalPlugin(state, source)).rejects.toThrow("普通文件");
  expect(await readdir(join(state, "plugins"))).toEqual([]);
});

it("opens HTTP MCP only for selected local plugins and keeps the credential out of the frozen snapshot", async () => {
  const { source, state } = await fixture();
  const seen: string[] = [];
  const received: (string | undefined)[] = [];
  const server = createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    seen.push(request.method);
    received.push(req.headers.authorization);
    if (request.id == null) {
      res.writeHead(202).end();
      return;
    }
    const result =
      request.method === "initialize"
        ? {
            protocolVersion: request.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "writer", version: "1" },
          }
        : {
            tools: [
              {
                name: "lookup",
                description: "Look up a word",
                inputSchema: { type: "object", properties: {} },
                annotations: { readOnlyHint: true },
              },
            ],
          };
    res
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing test port");
    await writeFile(
      join(source, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          terms: {
            url: `http://127.0.0.1:${address.port}/mcp`,
            http_headers: { Authorization: "Bearer fixture-only" },
          },
        },
      }),
    );
    await importLocalPlugin(state, source);
    await resolveDesktopPlugins(state, null, [], async () => empty, signal);
    expect(seen).toEqual([]);
    const { snapshot } = await resolveDesktopPlugins(state, null, [activation], async () => empty, signal);
    expect(seen).toContain("tools/list");
    expect(received.every((header) => header === "Bearer fixture-only")).toBe(true);
    expect(snapshot.plugins[0]?.manifest.mcpServers[0]?.tools[0]?.policy).toMatchObject({
      effect: "unknown",
      trust: "open-world",
    });
    expect(snapshot.connectionGrants[0]?.headers.Authorization).toBe("Bearer fixture-only");
    const frozen = toPersistedTurnPluginSnapshot(snapshot);
    expect(JSON.stringify(frozen)).not.toContain("fixture-only");
    const earlierRequests = [...seen];
    await writeFile(
      join(state, "plugins/writer/mcp.json"),
      JSON.stringify({ mcpServers: { terms: { url: `http://127.0.0.1:${address.port}/changed` } } }),
    );
    await expect(resolveDesktopPlugins(state, frozen, [], async () => empty, signal)).rejects.toThrow("已变更");
    expect(seen).toEqual(earlierRequests);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
