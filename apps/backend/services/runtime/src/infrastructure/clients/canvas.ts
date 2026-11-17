import { InnerApiCaller, InnerApiError, insecureChannelCredentials } from "@backend/inner-api/client";
import {
  CanvasGraph,
  CanvasServiceClient,
  type GenerateNodesResponse,
  type GetGraphResponse,
  StartStoryboardDraftsResponse,
  UpdateNodeResponse,
  type GenerationConfigPatch,
  type Position,
  type StoryboardModelConfig,
  type StoryboardPlanningConfig,
} from "@backend/inner-api/gen/canvas/v1/canvas";

import { propagationHeaders } from "#runtime/foundation";

import { AppError, ConflictError, NotFoundError, RequestError } from "../../application/errors.js";
import { getServerSettings } from "../../config/server.js";

export interface CanvasActor {
  userId: string;
  tenantId: string;
  workspaceId: string;
  workspaceRole: string;
}

export interface CanvasNodePatch {
  name?: string;
  prompt?: string;
  text?: string;
  position?: { position_x: number; position_y: number };
  video_input_mode?: number;
  generation_config?: {
    model_service_id?: string;
    resolution?: number;
    aspect_ratio?: number;
    duration_seconds?: number;
    generate_audio?: boolean;
    watermark?: boolean;
  };
}

export interface CanvasStoryboardDraftInput {
  plot: string;
  planning_config: {
    canvas_node_duration_min_seconds?: number;
    canvas_node_duration_max_seconds?: number;
    total_duration_min_seconds?: number;
    total_duration_max_seconds?: number;
  };
  model_config: {
    inference_model_service_id?: string;
    video_model_service_id?: string;
    video_parameters: { resolution: number; aspect_ratio: number; generate_audio: boolean; watermark: boolean };
  };
}

function canvasError(error: unknown): never {
  if (error instanceof InnerApiError) {
    if (error.code === 5 || error.code === 7) throw new NotFoundError("Canvas is missing or inaccessible");
    if (error.code === 9 || error.code === 10)
      throw new ConflictError("Canvas changed; read the current graph before retrying");
    if (error.code === 3) throw new RequestError("Invalid canvas operation");
    throw new AppError("Canvas service is unavailable", 502, "canvas_unavailable");
  }
  throw error;
}

class CanvasRpcClient {
  private readonly caller = new InnerApiCaller("runtime", 15_000);
  private readonly client: CanvasServiceClient;

  constructor(target: string) {
    this.client = new CanvasServiceClient(target, insecureChannelCredentials);
  }

  private actor(actor: CanvasActor) {
    return { userId: actor.userId, tenantId: actor.tenantId, workspaceId: actor.workspaceId };
  }

  private options(signal?: AbortSignal) {
    return { headers: propagationHeaders(), ...(signal ? { signal } : {}) };
  }

  async graph(actor: CanvasActor, projectId: string, canvasId: string, signal?: AbortSignal) {
    const response = await this.caller.unary<GetGraphResponse>(
      (metadata, options, callback) =>
        this.client.getGraph(
          { actor: this.actor(actor), workspaceRole: actor.workspaceRole, projectId, canvasId },
          metadata,
          options,
          callback,
        ),
      this.options(signal),
    );
    if (!response.graph) throw new Error("canvas returned no graph");
    return snakeJSON(CanvasGraph.toJSON(response.graph));
  }

  async startStoryboardDrafts(
    actor: CanvasActor,
    projectId: string,
    canvasId: string,
    input: CanvasStoryboardDraftInput,
    signal?: AbortSignal,
  ) {
    const planningConfig: StoryboardPlanningConfig = {
      canvasNodeDurationMinSeconds: input.planning_config.canvas_node_duration_min_seconds,
      canvasNodeDurationMaxSeconds: input.planning_config.canvas_node_duration_max_seconds,
      totalDurationMinSeconds: input.planning_config.total_duration_min_seconds,
      totalDurationMaxSeconds: input.planning_config.total_duration_max_seconds,
    };
    const modelConfig: StoryboardModelConfig = {
      inferenceModelServiceId: input.model_config.inference_model_service_id,
      videoModelServiceId: input.model_config.video_model_service_id,
      videoParameters: {
        resolution: input.model_config.video_parameters.resolution,
        aspectRatio: input.model_config.video_parameters.aspect_ratio,
        generateAudio: input.model_config.video_parameters.generate_audio,
        watermark: input.model_config.video_parameters.watermark,
      },
    };
    const response = await this.caller.unary<StartStoryboardDraftsResponse>(
      (metadata, options, callback) =>
        this.client.startStoryboardDrafts(
          {
            actor: this.actor(actor),
            workspaceRole: actor.workspaceRole,
            projectId,
            canvasId,
            plot: input.plot,
            planningConfig,
            modelConfig,
          },
          metadata,
          options,
          callback,
        ),
      this.options(signal),
    );
    return snakeJSON(StartStoryboardDraftsResponse.toJSON(response));
  }

  async generateNodes(
    actor: CanvasActor,
    projectId: string,
    canvasId: string,
    nodeIds: string[],
    signal?: AbortSignal,
  ) {
    const response = await this.caller.unary<GenerateNodesResponse>(
      (metadata, options, callback) =>
        this.client.generateNodes(
          { actor: this.actor(actor), workspaceRole: actor.workspaceRole, projectId, canvasId, nodeIds },
          metadata,
          options,
          callback,
        ),
      this.options(signal),
    );
    return { items: response.items.map((item) => ({ node_id: item.nodeId, task_run_id: item.taskRunId })) };
  }

  async updateNode(
    actor: CanvasActor,
    projectId: string,
    canvasId: string,
    nodeId: string,
    patch: CanvasNodePatch,
    signal?: AbortSignal,
  ) {
    const position: Position | undefined = patch.position
      ? { positionX: patch.position.position_x, positionY: patch.position.position_y }
      : undefined;
    const generationConfig: GenerationConfigPatch | undefined = patch.generation_config
      ? {
          modelServiceId: patch.generation_config.model_service_id,
          resolution: patch.generation_config.resolution,
          aspectRatio: patch.generation_config.aspect_ratio,
          durationSeconds: patch.generation_config.duration_seconds,
          generateAudio: patch.generation_config.generate_audio,
          watermark: patch.generation_config.watermark,
        }
      : undefined;
    const response = await this.caller.unary<UpdateNodeResponse>(
      (metadata, options, callback) =>
        this.client.updateNode(
          {
            actor: this.actor(actor),
            workspaceRole: actor.workspaceRole,
            projectId,
            canvasId,
            nodeId,
            name: patch.name,
            prompt: patch.prompt,
            text: patch.text,
            position,
            videoInputMode: patch.video_input_mode,
            generationConfig,
          },
          metadata,
          options,
          callback,
        ),
      this.options(signal),
    );
    return snakeJSON(UpdateNodeResponse.toJSON(response));
  }
}

function snakeJSON(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snakeJSON);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
      snakeJSON(item),
    ]),
  );
}

export function canvasClient() {
  const client = new CanvasRpcClient(getServerSettings().canvasRpcTarget);
  return {
    generateNodes: (...args: Parameters<CanvasRpcClient["generateNodes"]>) =>
      client.generateNodes(...args).catch(canvasError),
    startStoryboardDrafts: (...args: Parameters<CanvasRpcClient["startStoryboardDrafts"]>) =>
      client.startStoryboardDrafts(...args).catch(canvasError),
    updateNode: (...args: Parameters<CanvasRpcClient["updateNode"]>) => client.updateNode(...args).catch(canvasError),
    graph: (...args: Parameters<CanvasRpcClient["graph"]>) => client.graph(...args).catch(canvasError),
  };
}
