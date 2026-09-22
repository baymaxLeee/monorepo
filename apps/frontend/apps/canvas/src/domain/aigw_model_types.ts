// Source presentation model retained for the imported UI. Network calls use @repo/api OpenAPI clients.

import { CanvasThinkingModes as ThinkingModes } from "@repo/api";

export { ThinkingModes };

export type Int64 = number;

export interface AdvancedReviewConfig {
  /** 是否开启提示词防护 */
  EnablePrompt?: boolean;
  /** 是否开启模型滥用防护 */
  EnableModelMisuse?: boolean;
  /** 是否开启敏感数据防护 */
  EnablePiiLeakage?: boolean;
  /** 是否开启算力消耗防护 */
  EnableToken?: boolean;
}

/** APIConfig API配置 */
export interface APIConfig {
  /** ChatAPI配置，如果没有配置ChatAPI和ResponsesAPI，默认支持ChatAPI */
  Chat?: APIConfigDetails;
  /** ResponsesAPI配置 */
  Responses?: APIConfigDetails;
}

export interface APIConfigDetails {
  /** 是否支持，前端使用 */
  Supported?: boolean;
  /** 是否开启，后端使用 */
  Enabled?: boolean;
  Features?: Array<string>;
}

/** ASRConfig ASR配置，多语言 */
export interface ASRConfig {
  /** 多语言配置 */
  MultiLanguage?: MultiLanguageConfig;
}

export interface AudioConfig {
  /** TTS配置 */
  TTS?: TTSConfig;
  /** ASR配置 */
  ASR?: ASRConfig;
  /** 录音文件识别配置 */
  Transcription?: TranscriptionConfig;
}

export interface CommonBoolSwitch {
  /** 是否支持/开启 */
  Supported?: boolean;
  /** 默认值 */
  Enabled?: boolean;
}

/** CommonModelConfig 公共模型配置 */
export interface CommonModelConfig {
  /** 安全配置 */
  Security?: SecurityConfig;
}

export interface CommonSwitch {
  /** 可选值 */
  Types?: Array<string>;
  /** 默认值 */
  Default?: string;
}

/** CredentialFormSchema 凭证表单 schema */
export interface CredentialFormSchema {
  /** 变量名 */
  Name: string;
  /** 显示label */
  Label: string;
  /** 类型 */
  Type: string;
  /** 是否必填 */
  Required: boolean;
  /** 默认值 */
  Default?: string;
  /** 占位符。text-input 特有的表单项属性，表单项占位符 */
  Placeholder?: string;
  /** 选项。select 或 radio 特有的表单项属性，定义下拉内容 */
  Options?: Array<string>;
  /** 提示信息 */
  Tips?: string;
  /** 最大长度 */
  MaxLength?: number;
  /** 格式：json-json格式 */
  Format?: string;
  /** label国际化配置 */
  LabelI18N?: I18NConfig;
  /** 占位符国际化配置 */
  PlaceholderI18N?: I18NConfig;
  /** 提示信息国际化配置 */
  TipsI18N?: I18NConfig;
}

export interface DistributedInferenceConfig {
  /** 节点数 */
  NodeNum: number;
  /** 是否启用RDMA */
  RDMAEnabled?: boolean;
  /** 是否启用分布式推理 */
  Enabled?: boolean;
}

export interface DoubleRange {
  Min?: number;
  Max?: number;
  Default?: number;
  Switch?: CommonSwitch;
}

export interface EmbeddingConfig {
  HiddenSize?: HiddenSizeConfig;
  Input?: InputConfig;
  QueryInstruction?: QueryInstructionConfig;
}

/** FunctionCallPromptConfig function call prompt配置 */
export interface FunctionCallPromptConfig {
  /** 是否开启内联对话记录 */
  EnableInlineChatHistories?: boolean;
}

/** 向量维度 */
export interface HiddenSizeConfig {
  Supports?: Array<number>;
  Default: number;
}

export interface HWConfig {
  /** 图片生成支持的像素宽度范围 */
  Width?: IntRange;
  /** 图片生成支持的像素高度范围 */
  Height?: IntRange;
  /** 图片生成支持的宽高比范围 */
  Ratio?: DoubleRange;
  /** 图片生成支持的像素对 */
  Pairs?: Array<Array<number>>;
  /** 图片生成支持的总像素范围 */
  Total?: IntRange;
}

export interface I18NConfig {
  /** 国际化语言，包含语言code和国际化内容 */
  Languages?: Array<Language>;
}

/** 图片生成配置 */
export interface ImageConfig {
  /** 文生图 */
  TextToImage?: IOConfig;
  /** 图生图 */
  ImageToImage?: IOConfig;
  /** 图片生成支持的宽高像素比配置 */
  HW?: HWConfig;
  Resolution?: ResolutionConfig;
  NegativePrompt?: CommonSwitch;
  Watermark?: CommonBoolSwitch;
  Tools?: ToolConfig;
  Quality?: ImageQualityConfig;
}

export interface ImageQualityConfig {
  Switch?: CommonBoolSwitch;
  Supports?: Array<string>;
  Default?: string;
}

/** 图像理解配置 */
export interface ImageUnderstandConfig {
  /** 是否支持图像理解 */
  Enabled: boolean;
  /** 可选值 */
  Types?: Array<string>;
  /** 默认值 */
  DefaultType?: string;
}

export interface InputConfig {
  /** 总Token长度 */
  TotalTokens?: number;
  /** 单条文本输入Token长度 */
  SingleTextToken?: number;
  /** 最大文本数 */
  MaxTexts?: number;
}

export interface IntRange {
  Min?: Int64;
  Max?: Int64;
  Default?: Int64;
  Switch?: CommonSwitch;
}

/** 图片输入输出配置 */
export interface IOConfig {
  /** 多图输入开关 */
  Input?: CommonSwitch;
  /** 输入图片张数配置 */
  InputConfig?: IntRange;
  /** 多图输出开关 */
  Output?: CommonSwitch;
  /** 输出图片张数配置 */
  OutputConfig?: IntRange;
}

/** 模型标签 */
export interface LabelInfo {
  /** 标签编码 */
  Code: string;
  /** 标签名称 */
  Name?: string;
}

export interface Language {
  Code: string;
  Content: string;
}

export interface LanguageConfig {
  /** 是否预置，预置语言不可删除 */
  Preset: boolean;
  /** 语言，可以允许为空（表示不传值给模型） */
  Language?: string;
  /** 语言名称 */
  Name: string;
  /** 名称国际化 */
  NameI18N?: I18NConfig;
}

/** LLMConfig 大语言模型配置 */
export interface LLMConfig {
  /** API配置 */
  API?: APIConfig;
  /** token配置 */
  Token?: TokenConfig;
  /** 推理配置 */
  Reasoning?: ReasoningConfig;
  /** FunctionCall配置 */
  ToolCall?: ToolCallConfig;
  /** 图像理解配置 */
  Vision?: VisionUnderstandConfig;
  /** 是否支持流式输出 */
  Streaming?: boolean;
  /** 参数配置 */
  Parameter?: LLMParameterConfig;
}

export interface LLMParameterConfig {
  Temperature?: LLMTemperatureRange;
  TopP?: LLMTopPRange;
  Templates?: Array<LLMParameterTemplateItem>;
}

export interface LLMParameterTemplateItem {
  Template: string;
}

export interface LLMTemperatureRange {
  Min?: number;
  Max?: number;
  Default?: number;
}

export interface LLMTopPRange {
  Min?: number;
  Max?: number;
  Default?: number;
}

export interface LMCacheConfig {
  /** 是否开启 LMCache */
  Enabled: boolean;
  /** 内存，取值范围：0.01Gi-141Gi */
  Memory?: string;
}

export interface MaaSModelServiceDeployConfig {
  /** maas模型ID */
  ModelID: string;
  /** maas模型版本ID */
  ModelVersionID: string;
  /** maas模型来源 */
  ModelSource: string;
  /** 资源池ID */
  ResourceID: string;
  /** 资源名称即算力卡型号 */
  ResourceName: string;
  /** 资源配额ID */
  ResourceQuotaID: string;
  /** 模型服务资源规格配置 */
  Resource: ModelServiceResource;
  /** 模型服务配置 */
  Config?: ModelServiceConfig;
  /** 分布式推理配置 */
  DistributedInferenceConfig?: DistributedInferenceConfig;
  /** 资源池类型，当下可分为整卡和虚拟显卡两种类型 */
  ResourcePoolType: string;
}

/** 自定义角标 */
export interface MarkerDetails {
  /** 角标文案 */
  Text: string;
  /** 角标底色 */
  Color: string;
  /** 角标悬浮说明 */
  Description?: string;
}

export interface MaxTokens {
  /** 最大生成token数最大值 */
  Max: number;
  /** 最大生成token数最小值 */
  Min: number;
  /** 最大生成token数默认值 */
  Default: number;
}

/** ModelCredential 模型凭证 schema */
export interface ModelCredentialSchema {
  /** 模型凭证 */
  CredentialFormSchemas?: Array<CredentialFormSchema>;
}

/** ModelParameter 模型参数配置 */
export interface ModelParameter {
  /** 参数规则，适用于completions API */
  Rules?: Array<ParameterRule>;
}

export interface ModelServiceConfig {
  /** 量化配置 */
  Quantization?: QuantizationConfig;
  /** 每分钟请求数，取值范围：1-6000 */
  RateLimit?: RateLimit;
  /** 优雅关闭时间，单位：秒 */
  TerminationGracePeriodSeconds?: Int64;
  /** 只有支持深度思考模式切换才会存在该字段 */
  ThinkingModeByDefault?: ThinkingModes;
  /** 负载均衡策略:
智能负载均衡: Smart
轮询: RoundRobin,
最小队列长度: MinQueueLength
最小显存占用: MinXPUMemory
最小算力占用: MinXPUCore */
  LoadBalancePolicy?: string;
}

export interface ModelServiceResource {
  /** cpu，取值范围：0.01-32 */
  CPU: string;
  /** 内存，取值范围：0.01Gi-128Gi */
  Memory: string;
  /** gpu卡数，取值范围：1-32 */
  GPU: number;
  /** 副本数，取值范围：1-100 */
  Replica: number;
  /** 共享资源池：显存，取值范围：1Gi-128Gi */
  GPUMemory?: string;
  /** 共享资源池：算力，取值范围：1-100 */
  GPUCore?: number;
  /** 整卡资源池：卡型号 */
  GPUCardType?: string;
  /** LMCache 配置 */
  LMCacheConfig?: LMCacheConfig;
  /** MaxRelica 智能弹性伸缩最大副本数，为空表示固定副本数 */
  MaxReplica?: number;
  /** PD分离配置 */
  PdDisaggregationConfig?: PdDisaggregationConfig;
}

export interface MultiLanguageConfig {
  /** 是否启用 */
  Enabled: boolean;
  /** 语言 */
  Languages?: Array<LanguageConfig>;
  /** 默认语言 */
  DefaultLanguage?: string;
  /** 是否开启国际化 */
  EnableI18N: boolean;
  /** 国际化语言 */
  I18NLanguages?: Array<string>;
}

export interface MultiVoiceConfig {
  /** 是否启用 */
  Enabled: boolean;
  /** 音色 */
  Voices?: Array<VoiceConfig>;
  /** 默认音色 */
  DefaultVoice?: string;
  /** 是否开启国际化 */
  EnableI18N: boolean;
  /** 国际化语言 */
  I18NLanguages?: Array<string>;
}

/** ParameterMapping 模型参数映射 */
export interface ParameterMapping {
  /** 映射类型：rename-重命名，remove-移除 */
  Type: string;
  /** 名称，rename类型必填 */
  Name?: string;
  /** 映射值，map类型必填，目前仅支持string */
  Value?: string;
}

/** ParameterRule 模型参数规则 */
export interface ParameterRule {
  /** 参数名称，后续可以考虑支持json path */
  Name: string;
  /** 参数路径，支持json path */
  Path?: string;
  /** 参数类型 */
  Type?: string;
  /** 参数是否必填 */
  Required?: boolean;
  /** 参数默认值 */
  Default?: string;
  /** 最大值，浮点数 */
  Max?: string;
  /** 最小值，浮点数 */
  Min?: string;
  /** 参数映射 */
  Mapping?: ParameterMapping;
}

export interface PdDisaggregationConfig {
  PrefillConfig: PdDisaggregationResourceConfig;
  DecodeConfig: PdDisaggregationResourceConfig;
  /** 是否启用RDMA */
  RDMAEnabled?: boolean;
}

/** PD分离Decode配置 */
export interface PdDisaggregationResourceConfig {
  /** cpu，取值范围：0.01-32 */
  CPU: string;
  /** 内存，取值范围：0.01Gi-128Gi */
  Memory: string;
  /** gpu卡数，取值范围：1-32 */
  GPU: number;
  /** 卡型号 */
  GPUCardType: string;
  /** 副本数，取值范围：1-100 */
  Replica: number;
  /** 解码节点数 */
  NodeNum: number;
}

/** PolicyConfig 策略配置 */
export interface PolicyConfig {
  /** 限流 */
  RateLimitPolicy?: RateLimitPolicy;
  /** 重试 */
  RetryPolicy?: RetryPolicy;
  /** 超时 */
  TimeoutPolicy?: TimeoutPolicy;
  /** 审查 */
  ReviewPolicy?: ReviewPolicy;
  /** 负载均衡 */
  LoadBalancePolicy?: string;
}

/** PriceConfig 价格配置 */
export interface PriceConfig {
  /** 输入价格，默认0。260移除 */
  Prompt?: string;
  /** 输出价格，默认0。260移除 */
  Completion?: string;
  /** 单位，比如：0.001-价格是每千token价格，0.000001-价格是每百万token价格 */
  Unit: string;
  /** 币种，比如：RMB-人民币，USD-美元 */
  Currency: string;
  /** 类型，计费单位类型，比如：token-按照token计费，image-按照图片张数计费 */
  Type?: string;
  /** 输入价格，默认0 */
  Input?: string;
  /** 输出价格，默认0 */
  Output?: string;
}

/** PromptConfig prompt配置 */
export interface PromptConfig {
  /** reactPrompt配置 */
  ReactPrompt?: ReactPromptConfig;
  /** function call prompt配置 */
  FunctionCallPrompt?: FunctionCallPromptConfig;
}

export interface QuantizationConfig {
  /** 是否开启 */
  Enabled: boolean;
  /** 量化类型，取值：
transformers: INT8-整数8bit，INT4-整数4bit
vllm: FP8-浮点8bit，INT4-整数4bit */
  Type?: string;
}

/** QueryInstruction 配置 */
export interface QueryInstructionConfig {
  /** 是否开启 QueryInstruction */
  Enabled?: boolean;
  /** 生效范围，可选值：*（全部）、knowledgebase（知识库）、faq（问答库）、term（术语库） */
  Scope?: Array<string>;
}

export interface RateLimit {
  /** 是否开启限流 */
  Enabled: boolean;
  /** 每分钟请求数，取值范围：1-6000*100 */
  RPM?: number;
}

/** RateLimitPolicy is the rate limit strategy. */
export interface RateLimitPolicy {
  /** RPM限流策略 */
  RPMPolicy?: RPMPolicy;
  /** TPM限流策略 */
  TPMPolicy?: TPMPolicy;
}

/** ReactPromptConfig react prompt配置 */
export interface ReactPromptConfig {
  /** react提示词模板名称 */
  Name?: string;
  /** 是否开启few shots示例 */
  EnableFewshots?: boolean;
  /** 是否开启内联对话记录 */
  EnableInlineChatHistories?: boolean;
  /** 是否移除停止词 */
  RemoveStop?: boolean;
}

/** ReasoningConfig 推理配置 */
export interface ReasoningConfig {
  /** 推理开关 */
  Switch?: ReasoningSwitch;
  /** 推理深度 */
  Effort?: ReasoningEffort;
}

/** ReasoningEffort 推理努力程度
 [reasoning models](https://platform.openai.com/docs/guides/reasoning). */
export interface ReasoningEffort {
  /** 可选值 */
  Types?: Array<string>;
  /** 默认值 */
  DefaultType?: string;
}

/** ReasoningSwitch 推理开关 */
export interface ReasoningSwitch {
  /** 可选值 */
  Types?: Array<string>;
  /** 默认值 */
  DefaultType?: string;
}

/** 多模态参考生视频配置 */
export interface ReferenceConfig {
  Image?: ReferenceConfigDetail;
  Video?: ReferenceConfigDetail;
  Audio?: ReferenceConfigDetail;
}

export interface ReferenceConfigDetail {
  /** 是否支持 */
  Supported?: boolean;
  /** 最大支持数 */
  Max?: number;
}

export interface ResolutionConfig {
  /** 图片生成支持的分辨率, 1K\2K\4K */
  Values?: Array<string>;
  Switch?: CommonSwitch;
}

/** RetryPolicy is the retry strategy. */
export interface RetryPolicy {
  /** 是否开启限流 */
  Enabled: boolean;
  /** 重试次数，取值范围：1-6000*100 */
  Attempts?: number;
  /** 重试状态列表 */
  OnStatus?: Array<number>;
}

export interface ReviewPolicy {
  /** 是否启用审查 */
  Enabled: boolean;
  /** 高级审查类型 */
  AdvancedReviewType?: string;
  /** 高级审查配置 */
  AdvancedReviewConfig?: AdvancedReviewConfig;
}

export interface RPMPolicy {
  /** 是否开启限流 */
  Enabled: boolean;
  /** 请求数，取值范围：1-60万 */
  RPM?: number;
  /** 单位，默认分钟 */
  Unit?: string;
  /** 用量，已使用量 */
  Usage?: Int64;
}

/** SecurityConfig 安全配置 */
export interface SecurityConfig {
  /** 是否开启安全检查 */
  AICC?: CommonBoolSwitch;
}

/** TimeoutPolicy is the cache strategy. */
export interface TimeoutPolicy {
  /** 是否开启限流 */
  Enabled: boolean;
  /** 超时时间 */
  Timeout?: number;
}

/** TokenConfig token配置 */
export interface TokenConfig {
  /** 上下文窗口长度 */
  ContextTokens?: number;
  /** 最大生成token数配置 */
  MaxTokens?: MaxTokens;
}

/** ToolCallConfig FunctionCall配置 */
export interface ToolCallConfig {
  /** 是否支持流式FunctionCall */
  Streaming?: CommonBoolSwitch;
}

/** 工具使用配置 */
export interface ToolConfig {
  WebSearch?: CommonBoolSwitch;
}

export interface TPMPolicy {
  /** 是否开启限流 */
  Enabled: boolean;
  /** token，取值范围：1-100万 */
  TPM?: number;
  /** 单位，默认分钟 */
  Unit?: string;
  /** 用量，已使用量 */
  Usage?: Int64;
}

/** TranscriptionConfig 录音文件识别配置，多语言 */
export interface TranscriptionConfig {
  /** 多语言配置 */
  MultiLanguage?: MultiLanguageConfig;
}

/** TTSConfig TTS配置，多语言、多音色 */
export interface TTSConfig {
  /** 多语言配置 */
  MultiLanguage?: MultiLanguageConfig;
  /** 多音色配置 */
  MultiVoice?: MultiVoiceConfig;
}

export interface VisionFeature {
  Name: string;
  Switch?: CommonSwitch;
}

/** 视觉理解配置 */
export interface VisionUnderstandConfig {
  Image?: ImageUnderstandConfig;
}

export interface VoiceConfig {
  /** 是否预置 */
  Preset: boolean;
  /** 音色 */
  Voice: string;
  /** 音色名称 */
  Name: string;
  /** 支持的语言 */
  SupportedLanguages?: Array<string>;
  /** 名称国际化 */
  NameI18N?: I18NConfig;
}
/* eslint-enable */
