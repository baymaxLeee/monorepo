import { createHash } from "node:crypto";

import type { ResolvedPluginSkillContribution } from "@repo/agent-runtime";

import { storageClient } from "../../../infrastructure/clients/storage.js";
import type { HostPluginContext } from "../tools/catalog.js";

export interface PluginSkillContentSource {
  content(input: {
    tenantId: string;
    workspaceId: string;
    assetId: string;
    revisionId: string;
    signal?: AbortSignal;
  }): Promise<ReadableStream<Uint8Array>>;
}

/** Runtime host adapter for immutable plugin skill bodies stored as exact Storage revisions. */
export class RuntimePluginSkillAssetLoader {
  readonly #source?: PluginSkillContentSource;

  constructor(source?: PluginSkillContentSource) {
    this.#source = source;
  }

  async loadBody(skill: ResolvedPluginSkillContribution, context: HostPluginContext): Promise<string> {
    const stream = await (this.#source ?? storageClient()).content({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      assetId: skill.assetId,
      revisionId: skill.revisionId,
      signal: context.signal,
    });
    const hash = createHash("sha256");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let body = "";
    for await (const chunk of stream) {
      hash.update(chunk);
      body += decoder.decode(chunk, { stream: true });
    }
    body += decoder.decode();
    const actual = hash.digest("hex");
    if (actual !== skill.sha256) {
      throw new Error(
        `agent plugin ${skill.pluginId} skill ${skill.id} asset digest mismatch: expected ${skill.sha256}, received ${actual}`,
      );
    }
    if (!body.trim()) {
      throw new Error(`agent plugin ${skill.pluginId} skill ${skill.id} has an empty body`);
    }
    return body;
  }
}
