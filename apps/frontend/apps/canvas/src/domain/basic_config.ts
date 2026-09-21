// Source presentation model retained for the imported UI. Network calls use @repo/api OpenAPI clients.

export type Int64 = number;

/** DefaultModels 是 AgentFrame 当前租户的完整默认模型配置。 */
export interface DefaultModels {
  InferenceModel: ModelSelection;
  ImageModel: ModelSelection;
  VideoModel: ModelSelection;
}

export interface GetBasicConfigRequest {}

export interface GetBasicConfigResponse {
  DefaultModels: DefaultModels;
}

/** ModelConfig 是 AgentFrame 可透传给推理请求的默认调优参数。 */
export interface ModelConfig {
  Temperature?: number;
  TopP?: number;
  MaxTokens?: Int64;
  ReasoningEffortType?: string;
}

/** ModelSelection 是默认模型身份及其请求参数。 */
export interface ModelSelection {
  ModelID: string;
  ModelConfig: ModelConfig;
}

export interface UpdateBasicConfigRequest {
  DefaultModels: DefaultModels;
}

export interface UpdateBasicConfigResponse {
  DefaultModels: DefaultModels;
}
/* eslint-enable */
