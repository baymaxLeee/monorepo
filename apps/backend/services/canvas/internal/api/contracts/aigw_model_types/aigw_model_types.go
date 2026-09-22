package aigw_model_types

import (
	"database/sql"
	"database/sql/driver"
	"fmt"
)

type ThinkingModes int64

const (
	// 自动模式，模型根据上下文决定是否开启深度思考
	ThinkingModes_Auto ThinkingModes = 0
	// 开启深度思考模式
	ThinkingModes_Thinking ThinkingModes = 1
	// 关闭深度思考模式
	ThinkingModes_NoThinking ThinkingModes = 2
)

func (p ThinkingModes) String() string {
	switch p {
	case ThinkingModes_Auto:
		return "Auto"
	case ThinkingModes_Thinking:
		return "Thinking"
	case ThinkingModes_NoThinking:
		return "NoThinking"
	}
	return "<UNSET>"
}

func ThinkingModesFromString(s string) (ThinkingModes, error) {
	switch s {
	case "Auto":
		return ThinkingModes_Auto, nil
	case "Thinking":
		return ThinkingModes_Thinking, nil
	case "NoThinking":
		return ThinkingModes_NoThinking, nil
	}
	return ThinkingModes(0), fmt.Errorf("not a valid ThinkingModes string")
}

func ThinkingModesPtr(v ThinkingModes) *ThinkingModes { return &v }
func (p *ThinkingModes) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = ThinkingModes(result.Int64)
	return
}

func (p *ThinkingModes) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

// 策略时间窗口单位
type PolicyTimeUnit = string

// 负载均衡策略
type LoadBalancePolicy = string

// 计费类型
type PriceType = string

// 条件计费条件类型
type PriceConditionType = string

type SwitchType = string

// 图片生成质量
type ImageQuality = string

type VisionFeatureName = string

type LanguageCode = string

type ReasoningSwitchType = string

// 推理努力类型
type ReasoningEffortType = string

type ImageUnderstandType = string

type LLMParameterTemplate = string

// QueryInstruction 生效范围
type QueryInstructionScope = string

// 模型参数类型
type ParameterType = string

// 模型参数映射类型
type ParameterMappingType = string

// 凭证表单 schema 类型
type CredentialFormSchemaType = string

// 凭证表单 schema 格式
type CredentialFormSchemaFormat = string

type ModelFeature = string

// 模型来源
type ModelSource = string

type AdvancedReviewType = string

// 角标底色
type MarkerColor = string

type Resolution = string

type Ratio = string

type QuantizationType = string

type RPMPolicy struct {
	// 是否开启限流
	Enabled bool `json:"Enabled,required" `
	// 请求数，取值范围：1-60万
	RPM *int32 `validate:"omitempty,min=1,max=600000" json:"RPM,omitempty" `
	// 单位，默认分钟
	Unit PolicyTimeUnit `validate:"omitempty,oneof=minute hour day week month total" json:"Unit,omitempty" `
	// 用量，已使用量
	Usage *int64 `json:"Usage,omitempty" `
}

func NewRPMPolicy() *RPMPolicy {
	return &RPMPolicy{
		Unit: "minute",
	}
}

func (p *RPMPolicy) InitDefault() {
	p.Unit = "minute"
}

func (p *RPMPolicy) GetEnabled() (v bool) {
	return p.Enabled
}

var RPMPolicy_RPM_DEFAULT int32

func (p *RPMPolicy) GetRPM() (v int32) {
	if !p.IsSetRPM() {
		return RPMPolicy_RPM_DEFAULT
	}
	return *p.RPM
}

var RPMPolicy_Unit_DEFAULT PolicyTimeUnit = "minute"

func (p *RPMPolicy) GetUnit() (v PolicyTimeUnit) {
	if !p.IsSetUnit() {
		return RPMPolicy_Unit_DEFAULT
	}
	return p.Unit
}

var RPMPolicy_Usage_DEFAULT int64

func (p *RPMPolicy) GetUsage() (v int64) {
	if !p.IsSetUsage() {
		return RPMPolicy_Usage_DEFAULT
	}
	return *p.Usage
}

func (p *RPMPolicy) IsSetRPM() bool {
	return p.RPM != nil
}

func (p *RPMPolicy) IsSetUnit() bool {
	return p.Unit != RPMPolicy_Unit_DEFAULT
}

func (p *RPMPolicy) IsSetUsage() bool {
	return p.Usage != nil
}

func (p *RPMPolicy) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("RPMPolicy(%+v)", *p)
}

type TPMPolicy struct {
	// 是否开启限流
	Enabled bool `json:"Enabled,required" `
	// token，取值范围：1-100万
	TPM *int32 `validate:"omitempty,min=1,max=10000000" json:"TPM,omitempty" `
	// 单位，默认分钟
	Unit PolicyTimeUnit `validate:"omitempty,oneof=minute hour day week month total" json:"Unit,omitempty" `
	// 用量，已使用量
	Usage *int64 `json:"Usage,omitempty" `
}

func NewTPMPolicy() *TPMPolicy {
	return &TPMPolicy{
		Unit: "minute",
	}
}

func (p *TPMPolicy) InitDefault() {
	p.Unit = "minute"
}

func (p *TPMPolicy) GetEnabled() (v bool) {
	return p.Enabled
}

var TPMPolicy_TPM_DEFAULT int32

func (p *TPMPolicy) GetTPM() (v int32) {
	if !p.IsSetTPM() {
		return TPMPolicy_TPM_DEFAULT
	}
	return *p.TPM
}

var TPMPolicy_Unit_DEFAULT PolicyTimeUnit = "minute"

func (p *TPMPolicy) GetUnit() (v PolicyTimeUnit) {
	if !p.IsSetUnit() {
		return TPMPolicy_Unit_DEFAULT
	}
	return p.Unit
}

var TPMPolicy_Usage_DEFAULT int64

func (p *TPMPolicy) GetUsage() (v int64) {
	if !p.IsSetUsage() {
		return TPMPolicy_Usage_DEFAULT
	}
	return *p.Usage
}

func (p *TPMPolicy) IsSetTPM() bool {
	return p.TPM != nil
}

func (p *TPMPolicy) IsSetUnit() bool {
	return p.Unit != TPMPolicy_Unit_DEFAULT
}

func (p *TPMPolicy) IsSetUsage() bool {
	return p.Usage != nil
}

func (p *TPMPolicy) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("TPMPolicy(%+v)", *p)
}

type PricePolicy struct {
	// 是否开启限流
	Enabled bool `json:"Enabled,required" `
	// 金额
	Price *int64 `validate:"omitempty,min=1" json:"Price,omitempty" `
	// 单位，默认分钟
	Unit PolicyTimeUnit `validate:"omitempty,oneof=minute hour day week month total" json:"Unit,omitempty" `
	// 用量，已使用金额
	Usage *float64 `json:"Usage,omitempty" `
}

func NewPricePolicy() *PricePolicy {
	return &PricePolicy{
		Unit: "minute",
	}
}

func (p *PricePolicy) InitDefault() {
	p.Unit = "minute"
}

func (p *PricePolicy) GetEnabled() (v bool) {
	return p.Enabled
}

var PricePolicy_Price_DEFAULT int64

func (p *PricePolicy) GetPrice() (v int64) {
	if !p.IsSetPrice() {
		return PricePolicy_Price_DEFAULT
	}
	return *p.Price
}

var PricePolicy_Unit_DEFAULT PolicyTimeUnit = "minute"

func (p *PricePolicy) GetUnit() (v PolicyTimeUnit) {
	if !p.IsSetUnit() {
		return PricePolicy_Unit_DEFAULT
	}
	return p.Unit
}

var PricePolicy_Usage_DEFAULT float64

func (p *PricePolicy) GetUsage() (v float64) {
	if !p.IsSetUsage() {
		return PricePolicy_Usage_DEFAULT
	}
	return *p.Usage
}

func (p *PricePolicy) IsSetPrice() bool {
	return p.Price != nil
}

func (p *PricePolicy) IsSetUnit() bool {
	return p.Unit != PricePolicy_Unit_DEFAULT
}

func (p *PricePolicy) IsSetUsage() bool {
	return p.Usage != nil
}

func (p *PricePolicy) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("PricePolicy(%+v)", *p)
}

// RateLimitPolicy is the rate limit strategy.
type RateLimitPolicy struct {
	// RPM限流策略
	RPMPolicy *RPMPolicy `json:"RPMPolicy,omitempty" `
	// TPM限流策略
	TPMPolicy *TPMPolicy `json:"TPMPolicy,omitempty" `
}

func NewRateLimitPolicy() *RateLimitPolicy {
	return &RateLimitPolicy{}
}

func (p *RateLimitPolicy) InitDefault() {
}

var RateLimitPolicy_RPMPolicy_DEFAULT *RPMPolicy

func (p *RateLimitPolicy) GetRPMPolicy() (v *RPMPolicy) {
	if !p.IsSetRPMPolicy() {
		return RateLimitPolicy_RPMPolicy_DEFAULT
	}
	return p.RPMPolicy
}

var RateLimitPolicy_TPMPolicy_DEFAULT *TPMPolicy

func (p *RateLimitPolicy) GetTPMPolicy() (v *TPMPolicy) {
	if !p.IsSetTPMPolicy() {
		return RateLimitPolicy_TPMPolicy_DEFAULT
	}
	return p.TPMPolicy
}

func (p *RateLimitPolicy) IsSetRPMPolicy() bool {
	return p.RPMPolicy != nil
}

func (p *RateLimitPolicy) IsSetTPMPolicy() bool {
	return p.TPMPolicy != nil
}

func (p *RateLimitPolicy) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("RateLimitPolicy(%+v)", *p)
}

// RetryPolicy is the retry strategy.
type RetryPolicy struct {
	// 是否开启限流
	Enabled bool `json:"Enabled,required" `
	// 重试次数，取值范围：1-6000*100
	Attempts *int32 `validate:"omitempty,min=1,max=600000" json:"Attempts,omitempty" `
	// 重试状态列表
	OnStatus []int32 `validate:"omitempty" json:"OnStatus,omitempty" `
}

func NewRetryPolicy() *RetryPolicy {
	return &RetryPolicy{}
}

func (p *RetryPolicy) InitDefault() {
}

func (p *RetryPolicy) GetEnabled() (v bool) {
	return p.Enabled
}

var RetryPolicy_Attempts_DEFAULT int32

func (p *RetryPolicy) GetAttempts() (v int32) {
	if !p.IsSetAttempts() {
		return RetryPolicy_Attempts_DEFAULT
	}
	return *p.Attempts
}

var RetryPolicy_OnStatus_DEFAULT []int32

func (p *RetryPolicy) GetOnStatus() (v []int32) {
	if !p.IsSetOnStatus() {
		return RetryPolicy_OnStatus_DEFAULT
	}
	return p.OnStatus
}

func (p *RetryPolicy) IsSetAttempts() bool {
	return p.Attempts != nil
}

func (p *RetryPolicy) IsSetOnStatus() bool {
	return p.OnStatus != nil
}

func (p *RetryPolicy) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("RetryPolicy(%+v)", *p)
}

// TimeoutPolicy is the cache strategy.
type TimeoutPolicy struct {
	// 是否开启限流
	Enabled bool `json:"Enabled,required" `
	// 超时时间
	Timeout *int32 `validate:"omitempty" json:"Timeout,omitempty" `
}

func NewTimeoutPolicy() *TimeoutPolicy {
	return &TimeoutPolicy{}
}

func (p *TimeoutPolicy) InitDefault() {
}

func (p *TimeoutPolicy) GetEnabled() (v bool) {
	return p.Enabled
}

var TimeoutPolicy_Timeout_DEFAULT int32

func (p *TimeoutPolicy) GetTimeout() (v int32) {
	if !p.IsSetTimeout() {
		return TimeoutPolicy_Timeout_DEFAULT
	}
	return *p.Timeout
}

func (p *TimeoutPolicy) IsSetTimeout() bool {
	return p.Timeout != nil
}

func (p *TimeoutPolicy) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("TimeoutPolicy(%+v)", *p)
}

type ReviewPolicy struct {
	// 是否启用审查
	Enabled bool `json:"Enabled,required" `
	// 高级审查类型
	AdvancedReviewType *AdvancedReviewType `json:"AdvancedReviewType,omitempty" `
	// 高级审查配置
	AdvancedReviewConfig *AdvancedReviewConfig `json:"AdvancedReviewConfig,omitempty" `
}

func NewReviewPolicy() *ReviewPolicy {
	return &ReviewPolicy{}
}

func (p *ReviewPolicy) InitDefault() {
}

func (p *ReviewPolicy) GetEnabled() (v bool) {
	return p.Enabled
}

var ReviewPolicy_AdvancedReviewType_DEFAULT AdvancedReviewType

func (p *ReviewPolicy) GetAdvancedReviewType() (v AdvancedReviewType) {
	if !p.IsSetAdvancedReviewType() {
		return ReviewPolicy_AdvancedReviewType_DEFAULT
	}
	return *p.AdvancedReviewType
}

var ReviewPolicy_AdvancedReviewConfig_DEFAULT *AdvancedReviewConfig

func (p *ReviewPolicy) GetAdvancedReviewConfig() (v *AdvancedReviewConfig) {
	if !p.IsSetAdvancedReviewConfig() {
		return ReviewPolicy_AdvancedReviewConfig_DEFAULT
	}
	return p.AdvancedReviewConfig
}

func (p *ReviewPolicy) IsSetAdvancedReviewType() bool {
	return p.AdvancedReviewType != nil
}

func (p *ReviewPolicy) IsSetAdvancedReviewConfig() bool {
	return p.AdvancedReviewConfig != nil
}

func (p *ReviewPolicy) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ReviewPolicy(%+v)", *p)
}

type AdvancedReviewConfig struct {
	// 是否开启提示词防护
	EnablePrompt bool `json:"EnablePrompt" `
	// 是否开启模型滥用防护
	EnableModelMisuse bool `json:"EnableModelMisuse" `
	// 是否开启敏感数据防护
	EnablePiiLeakage bool `json:"EnablePiiLeakage" `
	// 是否开启算力消耗防护
	EnableToken bool `json:"EnableToken" `
}

func NewAdvancedReviewConfig() *AdvancedReviewConfig {
	return &AdvancedReviewConfig{}
}

func (p *AdvancedReviewConfig) InitDefault() {
}

func (p *AdvancedReviewConfig) GetEnablePrompt() (v bool) {
	return p.EnablePrompt
}

func (p *AdvancedReviewConfig) GetEnableModelMisuse() (v bool) {
	return p.EnableModelMisuse
}

func (p *AdvancedReviewConfig) GetEnablePiiLeakage() (v bool) {
	return p.EnablePiiLeakage
}

func (p *AdvancedReviewConfig) GetEnableToken() (v bool) {
	return p.EnableToken
}

func (p *AdvancedReviewConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("AdvancedReviewConfig(%+v)", *p)
}

// PolicyConfig 策略配置
type PolicyConfig struct {
	// 限流
	RateLimitPolicy *RateLimitPolicy `json:"RateLimitPolicy,omitempty" `
	// 重试
	RetryPolicy *RetryPolicy `json:"RetryPolicy,omitempty" `
	// 超时
	TimeoutPolicy *TimeoutPolicy `json:"TimeoutPolicy,omitempty" `
	// 审查
	ReviewPolicy *ReviewPolicy `json:"ReviewPolicy,omitempty" `
	// 负载均衡
	LoadBalancePolicy *LoadBalancePolicy `json:"LoadBalancePolicy,omitempty" `
}

func NewPolicyConfig() *PolicyConfig {
	return &PolicyConfig{}
}

func (p *PolicyConfig) InitDefault() {
}

var PolicyConfig_RateLimitPolicy_DEFAULT *RateLimitPolicy

func (p *PolicyConfig) GetRateLimitPolicy() (v *RateLimitPolicy) {
	if !p.IsSetRateLimitPolicy() {
		return PolicyConfig_RateLimitPolicy_DEFAULT
	}
	return p.RateLimitPolicy
}

var PolicyConfig_RetryPolicy_DEFAULT *RetryPolicy

func (p *PolicyConfig) GetRetryPolicy() (v *RetryPolicy) {
	if !p.IsSetRetryPolicy() {
		return PolicyConfig_RetryPolicy_DEFAULT
	}
	return p.RetryPolicy
}

var PolicyConfig_TimeoutPolicy_DEFAULT *TimeoutPolicy

func (p *PolicyConfig) GetTimeoutPolicy() (v *TimeoutPolicy) {
	if !p.IsSetTimeoutPolicy() {
		return PolicyConfig_TimeoutPolicy_DEFAULT
	}
	return p.TimeoutPolicy
}

var PolicyConfig_ReviewPolicy_DEFAULT *ReviewPolicy

func (p *PolicyConfig) GetReviewPolicy() (v *ReviewPolicy) {
	if !p.IsSetReviewPolicy() {
		return PolicyConfig_ReviewPolicy_DEFAULT
	}
	return p.ReviewPolicy
}

var PolicyConfig_LoadBalancePolicy_DEFAULT LoadBalancePolicy

func (p *PolicyConfig) GetLoadBalancePolicy() (v LoadBalancePolicy) {
	if !p.IsSetLoadBalancePolicy() {
		return PolicyConfig_LoadBalancePolicy_DEFAULT
	}
	return *p.LoadBalancePolicy
}

func (p *PolicyConfig) IsSetRateLimitPolicy() bool {
	return p.RateLimitPolicy != nil
}

func (p *PolicyConfig) IsSetRetryPolicy() bool {
	return p.RetryPolicy != nil
}

func (p *PolicyConfig) IsSetTimeoutPolicy() bool {
	return p.TimeoutPolicy != nil
}

func (p *PolicyConfig) IsSetReviewPolicy() bool {
	return p.ReviewPolicy != nil
}

func (p *PolicyConfig) IsSetLoadBalancePolicy() bool {
	return p.LoadBalancePolicy != nil
}

func (p *PolicyConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("PolicyConfig(%+v)", *p)
}

// ReactPromptConfig react prompt配置
type ReactPromptConfig struct {
	// react提示词模板名称
	Name *string `json:"Name,omitempty" `
	// 是否开启few shots示例
	EnableFewshots *bool `json:"EnableFewshots,omitempty" `
	// 是否开启内联对话记录
	EnableInlineChatHistories *bool `json:"EnableInlineChatHistories,omitempty" `
	// 是否移除停止词
	RemoveStop *bool `json:"RemoveStop,omitempty" `
}

func NewReactPromptConfig() *ReactPromptConfig {
	return &ReactPromptConfig{}
}

func (p *ReactPromptConfig) InitDefault() {
}

var ReactPromptConfig_Name_DEFAULT string

func (p *ReactPromptConfig) GetName() (v string) {
	if !p.IsSetName() {
		return ReactPromptConfig_Name_DEFAULT
	}
	return *p.Name
}

var ReactPromptConfig_EnableFewshots_DEFAULT bool

func (p *ReactPromptConfig) GetEnableFewshots() (v bool) {
	if !p.IsSetEnableFewshots() {
		return ReactPromptConfig_EnableFewshots_DEFAULT
	}
	return *p.EnableFewshots
}

var ReactPromptConfig_EnableInlineChatHistories_DEFAULT bool

func (p *ReactPromptConfig) GetEnableInlineChatHistories() (v bool) {
	if !p.IsSetEnableInlineChatHistories() {
		return ReactPromptConfig_EnableInlineChatHistories_DEFAULT
	}
	return *p.EnableInlineChatHistories
}

var ReactPromptConfig_RemoveStop_DEFAULT bool

func (p *ReactPromptConfig) GetRemoveStop() (v bool) {
	if !p.IsSetRemoveStop() {
		return ReactPromptConfig_RemoveStop_DEFAULT
	}
	return *p.RemoveStop
}

func (p *ReactPromptConfig) IsSetName() bool {
	return p.Name != nil
}

func (p *ReactPromptConfig) IsSetEnableFewshots() bool {
	return p.EnableFewshots != nil
}

func (p *ReactPromptConfig) IsSetEnableInlineChatHistories() bool {
	return p.EnableInlineChatHistories != nil
}

func (p *ReactPromptConfig) IsSetRemoveStop() bool {
	return p.RemoveStop != nil
}

func (p *ReactPromptConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ReactPromptConfig(%+v)", *p)
}

// FunctionCallPromptConfig function call prompt配置
type FunctionCallPromptConfig struct {
	// 是否开启内联对话记录
	EnableInlineChatHistories *bool `json:"EnableInlineChatHistories,omitempty" `
}

func NewFunctionCallPromptConfig() *FunctionCallPromptConfig {
	return &FunctionCallPromptConfig{}
}

func (p *FunctionCallPromptConfig) InitDefault() {
}

var FunctionCallPromptConfig_EnableInlineChatHistories_DEFAULT bool

func (p *FunctionCallPromptConfig) GetEnableInlineChatHistories() (v bool) {
	if !p.IsSetEnableInlineChatHistories() {
		return FunctionCallPromptConfig_EnableInlineChatHistories_DEFAULT
	}
	return *p.EnableInlineChatHistories
}

func (p *FunctionCallPromptConfig) IsSetEnableInlineChatHistories() bool {
	return p.EnableInlineChatHistories != nil
}

func (p *FunctionCallPromptConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("FunctionCallPromptConfig(%+v)", *p)
}

// PromptConfig prompt配置
type PromptConfig struct {
	// reactPrompt配置
	ReactPrompt *ReactPromptConfig `json:"ReactPrompt,omitempty" `
	// function call prompt配置
	FunctionCallPrompt *FunctionCallPromptConfig `json:"FunctionCallPrompt,omitempty" `
}

func NewPromptConfig() *PromptConfig {
	return &PromptConfig{}
}

func (p *PromptConfig) InitDefault() {
}

var PromptConfig_ReactPrompt_DEFAULT *ReactPromptConfig

func (p *PromptConfig) GetReactPrompt() (v *ReactPromptConfig) {
	if !p.IsSetReactPrompt() {
		return PromptConfig_ReactPrompt_DEFAULT
	}
	return p.ReactPrompt
}

var PromptConfig_FunctionCallPrompt_DEFAULT *FunctionCallPromptConfig

func (p *PromptConfig) GetFunctionCallPrompt() (v *FunctionCallPromptConfig) {
	if !p.IsSetFunctionCallPrompt() {
		return PromptConfig_FunctionCallPrompt_DEFAULT
	}
	return p.FunctionCallPrompt
}

func (p *PromptConfig) IsSetReactPrompt() bool {
	return p.ReactPrompt != nil
}

func (p *PromptConfig) IsSetFunctionCallPrompt() bool {
	return p.FunctionCallPrompt != nil
}

func (p *PromptConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("PromptConfig(%+v)", *p)
}

// 视觉模型输出视频请求分辨率条件参数
type VisionVideoRequestResolutionCondition struct {
	// 输出视频分辨率，允许为空；为空时匹配未传 resolution 的请求
	Resolution *string `validate:"omitempty,oneof=480p 720p 1080p 4k" json:"Resolution,omitempty" `
	// 输入是否包含视频，允许为空；为空时匹配未传 includeVideo 的请求
	IncludeVideo *bool `json:"IncludeVideo,omitempty" `
}

func NewVisionVideoRequestResolutionCondition() *VisionVideoRequestResolutionCondition {
	return &VisionVideoRequestResolutionCondition{}
}

func (p *VisionVideoRequestResolutionCondition) InitDefault() {
}

var VisionVideoRequestResolutionCondition_Resolution_DEFAULT string

func (p *VisionVideoRequestResolutionCondition) GetResolution() (v string) {
	if !p.IsSetResolution() {
		return VisionVideoRequestResolutionCondition_Resolution_DEFAULT
	}
	return *p.Resolution
}

var VisionVideoRequestResolutionCondition_IncludeVideo_DEFAULT bool

func (p *VisionVideoRequestResolutionCondition) GetIncludeVideo() (v bool) {
	if !p.IsSetIncludeVideo() {
		return VisionVideoRequestResolutionCondition_IncludeVideo_DEFAULT
	}
	return *p.IncludeVideo
}

func (p *VisionVideoRequestResolutionCondition) IsSetResolution() bool {
	return p.Resolution != nil
}

func (p *VisionVideoRequestResolutionCondition) IsSetIncludeVideo() bool {
	return p.IncludeVideo != nil
}

func (p *VisionVideoRequestResolutionCondition) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("VisionVideoRequestResolutionCondition(%+v)", *p)
}

// 条件价格配置
type ConditionPriceConfig struct {
	// 条件类型
	Type PriceConditionType `validate:"required,oneof=visionVideoRequestResolution" json:"Type,required" `
	// 视觉模型输出视频请求分辨率条件
	VisionVideoRequestResolution *VisionVideoRequestResolutionCondition `json:"VisionVideoRequestResolution,omitempty" `
	// 输入价格，默认0
	Input *string `json:"Input,omitempty" `
	// 输出价格，默认0
	Output *string `json:"Output,omitempty" `
}

func NewConditionPriceConfig() *ConditionPriceConfig {
	return &ConditionPriceConfig{}
}

func (p *ConditionPriceConfig) InitDefault() {
}

func (p *ConditionPriceConfig) GetType() (v PriceConditionType) {
	return p.Type
}

var ConditionPriceConfig_VisionVideoRequestResolution_DEFAULT *VisionVideoRequestResolutionCondition

func (p *ConditionPriceConfig) GetVisionVideoRequestResolution() (v *VisionVideoRequestResolutionCondition) {
	if !p.IsSetVisionVideoRequestResolution() {
		return ConditionPriceConfig_VisionVideoRequestResolution_DEFAULT
	}
	return p.VisionVideoRequestResolution
}

var ConditionPriceConfig_Input_DEFAULT string

func (p *ConditionPriceConfig) GetInput() (v string) {
	if !p.IsSetInput() {
		return ConditionPriceConfig_Input_DEFAULT
	}
	return *p.Input
}

var ConditionPriceConfig_Output_DEFAULT string

func (p *ConditionPriceConfig) GetOutput() (v string) {
	if !p.IsSetOutput() {
		return ConditionPriceConfig_Output_DEFAULT
	}
	return *p.Output
}

func (p *ConditionPriceConfig) IsSetVisionVideoRequestResolution() bool {
	return p.VisionVideoRequestResolution != nil
}

func (p *ConditionPriceConfig) IsSetInput() bool {
	return p.Input != nil
}

func (p *ConditionPriceConfig) IsSetOutput() bool {
	return p.Output != nil
}

func (p *ConditionPriceConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ConditionPriceConfig(%+v)", *p)
}

// PriceConfig 价格配置
type PriceConfig struct {
	// 输入价格，默认0。260移除
	Prompt *string `json:"Prompt,omitempty" `
	// 输出价格，默认0。260移除
	Completion *string `json:"Completion,omitempty" `
	// 单位，比如：0.001-价格是每千token价格，0.000001-价格是每百万token价格
	Unit string `json:"Unit,required" `
	// 币种，比如：RMB-人民币，USD-美元
	Currency string `json:"Currency,required" `
	// 类型，计费单位类型，比如：token-按照token计费，image-按照图片张数计费
	Type *PriceType `json:"Type,omitempty" `
	// 输入价格，默认0
	Input *string `json:"Input,omitempty" `
	// 输出价格，默认0
	Output *string `json:"Output,omitempty" `
}

func NewPriceConfig() *PriceConfig {
	return &PriceConfig{}
}

func (p *PriceConfig) InitDefault() {
}

var PriceConfig_Prompt_DEFAULT string

func (p *PriceConfig) GetPrompt() (v string) {
	if !p.IsSetPrompt() {
		return PriceConfig_Prompt_DEFAULT
	}
	return *p.Prompt
}

var PriceConfig_Completion_DEFAULT string

func (p *PriceConfig) GetCompletion() (v string) {
	if !p.IsSetCompletion() {
		return PriceConfig_Completion_DEFAULT
	}
	return *p.Completion
}

func (p *PriceConfig) GetUnit() (v string) {
	return p.Unit
}

func (p *PriceConfig) GetCurrency() (v string) {
	return p.Currency
}

var PriceConfig_Type_DEFAULT PriceType

func (p *PriceConfig) GetType() (v PriceType) {
	if !p.IsSetType() {
		return PriceConfig_Type_DEFAULT
	}
	return *p.Type
}

var PriceConfig_Input_DEFAULT string

func (p *PriceConfig) GetInput() (v string) {
	if !p.IsSetInput() {
		return PriceConfig_Input_DEFAULT
	}
	return *p.Input
}

var PriceConfig_Output_DEFAULT string

func (p *PriceConfig) GetOutput() (v string) {
	if !p.IsSetOutput() {
		return PriceConfig_Output_DEFAULT
	}
	return *p.Output
}

func (p *PriceConfig) IsSetPrompt() bool {
	return p.Prompt != nil
}

func (p *PriceConfig) IsSetCompletion() bool {
	return p.Completion != nil
}

func (p *PriceConfig) IsSetType() bool {
	return p.Type != nil
}

func (p *PriceConfig) IsSetInput() bool {
	return p.Input != nil
}

func (p *PriceConfig) IsSetOutput() bool {
	return p.Output != nil
}

func (p *PriceConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("PriceConfig(%+v)", *p)
}

type CommonSwitch struct {
	// 可选值
	Types []SwitchType `json:"Types,omitempty" `
	// 默认值
	Default *SwitchType `json:"Default,omitempty" `
}

func NewCommonSwitch() *CommonSwitch {
	return &CommonSwitch{}
}

func (p *CommonSwitch) InitDefault() {
}

var CommonSwitch_Types_DEFAULT []SwitchType

func (p *CommonSwitch) GetTypes() (v []SwitchType) {
	if !p.IsSetTypes() {
		return CommonSwitch_Types_DEFAULT
	}
	return p.Types
}

var CommonSwitch_Default_DEFAULT SwitchType

func (p *CommonSwitch) GetDefault() (v SwitchType) {
	if !p.IsSetDefault() {
		return CommonSwitch_Default_DEFAULT
	}
	return *p.Default
}

func (p *CommonSwitch) IsSetTypes() bool {
	return p.Types != nil
}

func (p *CommonSwitch) IsSetDefault() bool {
	return p.Default != nil
}

func (p *CommonSwitch) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CommonSwitch(%+v)", *p)
}

type CommonBoolSwitch struct {
	// 是否支持/开启
	Supported *bool `json:"Supported,omitempty" `
	// 默认值
	Enabled *bool `json:"Enabled,omitempty" `
}

func NewCommonBoolSwitch() *CommonBoolSwitch {
	return &CommonBoolSwitch{}
}

func (p *CommonBoolSwitch) InitDefault() {
}

var CommonBoolSwitch_Supported_DEFAULT bool

func (p *CommonBoolSwitch) GetSupported() (v bool) {
	if !p.IsSetSupported() {
		return CommonBoolSwitch_Supported_DEFAULT
	}
	return *p.Supported
}

var CommonBoolSwitch_Enabled_DEFAULT bool

func (p *CommonBoolSwitch) GetEnabled() (v bool) {
	if !p.IsSetEnabled() {
		return CommonBoolSwitch_Enabled_DEFAULT
	}
	return *p.Enabled
}

func (p *CommonBoolSwitch) IsSetSupported() bool {
	return p.Supported != nil
}

func (p *CommonBoolSwitch) IsSetEnabled() bool {
	return p.Enabled != nil
}

func (p *CommonBoolSwitch) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CommonBoolSwitch(%+v)", *p)
}

type RatioConfig struct {
	Values   []string `json:"Values,omitempty" `
	Adaptive *bool    `json:"Adaptive,omitempty" `
	Default  *string  `json:"Default,omitempty" `
}

func NewRatioConfig() *RatioConfig {
	return &RatioConfig{}
}

func (p *RatioConfig) InitDefault() {
}

var RatioConfig_Values_DEFAULT []string

func (p *RatioConfig) GetValues() (v []string) {
	if !p.IsSetValues() {
		return RatioConfig_Values_DEFAULT
	}
	return p.Values
}

var RatioConfig_Adaptive_DEFAULT bool

func (p *RatioConfig) GetAdaptive() (v bool) {
	if !p.IsSetAdaptive() {
		return RatioConfig_Adaptive_DEFAULT
	}
	return *p.Adaptive
}

var RatioConfig_Default_DEFAULT string

func (p *RatioConfig) GetDefault() (v string) {
	if !p.IsSetDefault() {
		return RatioConfig_Default_DEFAULT
	}
	return *p.Default
}

func (p *RatioConfig) IsSetValues() bool {
	return p.Values != nil
}

func (p *RatioConfig) IsSetAdaptive() bool {
	return p.Adaptive != nil
}

func (p *RatioConfig) IsSetDefault() bool {
	return p.Default != nil
}

func (p *RatioConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("RatioConfig(%+v)", *p)
}

// unit is second
type Duration struct {
	Min              *int32  `json:"Min,omitempty" `
	Max              *int32  `json:"Max,omitempty" `
	Default          *int32  `json:"Default,omitempty" `
	Recommends       []int32 `json:"Recommends,omitempty" `
	RecommendDefault *int32  `json:"RecommendDefault,omitempty" `
}

func NewDuration() *Duration {
	return &Duration{}
}

func (p *Duration) InitDefault() {
}

var Duration_Min_DEFAULT int32

func (p *Duration) GetMin() (v int32) {
	if !p.IsSetMin() {
		return Duration_Min_DEFAULT
	}
	return *p.Min
}

var Duration_Max_DEFAULT int32

func (p *Duration) GetMax() (v int32) {
	if !p.IsSetMax() {
		return Duration_Max_DEFAULT
	}
	return *p.Max
}

var Duration_Default_DEFAULT int32

func (p *Duration) GetDefault() (v int32) {
	if !p.IsSetDefault() {
		return Duration_Default_DEFAULT
	}
	return *p.Default
}

var Duration_Recommends_DEFAULT []int32

func (p *Duration) GetRecommends() (v []int32) {
	if !p.IsSetRecommends() {
		return Duration_Recommends_DEFAULT
	}
	return p.Recommends
}

var Duration_RecommendDefault_DEFAULT int32

func (p *Duration) GetRecommendDefault() (v int32) {
	if !p.IsSetRecommendDefault() {
		return Duration_RecommendDefault_DEFAULT
	}
	return *p.RecommendDefault
}

func (p *Duration) IsSetMin() bool {
	return p.Min != nil
}

func (p *Duration) IsSetMax() bool {
	return p.Max != nil
}

func (p *Duration) IsSetDefault() bool {
	return p.Default != nil
}

func (p *Duration) IsSetRecommends() bool {
	return p.Recommends != nil
}

func (p *Duration) IsSetRecommendDefault() bool {
	return p.RecommendDefault != nil
}

func (p *Duration) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("Duration(%+v)", *p)
}

type ReferenceConfigDetail struct {
	// 是否支持
	Supported *bool `json:"Supported,omitempty" `
	// 最大支持数
	Max *int8 `json:"Max,omitempty" `
}

func NewReferenceConfigDetail() *ReferenceConfigDetail {
	return &ReferenceConfigDetail{}
}

func (p *ReferenceConfigDetail) InitDefault() {
}

var ReferenceConfigDetail_Supported_DEFAULT bool

func (p *ReferenceConfigDetail) GetSupported() (v bool) {
	if !p.IsSetSupported() {
		return ReferenceConfigDetail_Supported_DEFAULT
	}
	return *p.Supported
}

var ReferenceConfigDetail_Max_DEFAULT int8

func (p *ReferenceConfigDetail) GetMax() (v int8) {
	if !p.IsSetMax() {
		return ReferenceConfigDetail_Max_DEFAULT
	}
	return *p.Max
}

func (p *ReferenceConfigDetail) IsSetSupported() bool {
	return p.Supported != nil
}

func (p *ReferenceConfigDetail) IsSetMax() bool {
	return p.Max != nil
}

func (p *ReferenceConfigDetail) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ReferenceConfigDetail(%+v)", *p)
}

// 多模态参考生视频配置
type ReferenceConfig struct {
	Image *ReferenceConfigDetail `json:"Image,omitempty" `
	Video *ReferenceConfigDetail `json:"Video,omitempty" `
	Audio *ReferenceConfigDetail `json:"Audio,omitempty" `
}

func NewReferenceConfig() *ReferenceConfig {
	return &ReferenceConfig{}
}

func (p *ReferenceConfig) InitDefault() {
}

var ReferenceConfig_Image_DEFAULT *ReferenceConfigDetail

func (p *ReferenceConfig) GetImage() (v *ReferenceConfigDetail) {
	if !p.IsSetImage() {
		return ReferenceConfig_Image_DEFAULT
	}
	return p.Image
}

var ReferenceConfig_Video_DEFAULT *ReferenceConfigDetail

func (p *ReferenceConfig) GetVideo() (v *ReferenceConfigDetail) {
	if !p.IsSetVideo() {
		return ReferenceConfig_Video_DEFAULT
	}
	return p.Video
}

var ReferenceConfig_Audio_DEFAULT *ReferenceConfigDetail

func (p *ReferenceConfig) GetAudio() (v *ReferenceConfigDetail) {
	if !p.IsSetAudio() {
		return ReferenceConfig_Audio_DEFAULT
	}
	return p.Audio
}

func (p *ReferenceConfig) IsSetImage() bool {
	return p.Image != nil
}

func (p *ReferenceConfig) IsSetVideo() bool {
	return p.Video != nil
}

func (p *ReferenceConfig) IsSetAudio() bool {
	return p.Audio != nil
}

func (p *ReferenceConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ReferenceConfig(%+v)", *p)
}

type ImageQualityConfig struct {
	Switch   *CommonBoolSwitch `json:"Switch,omitempty" `
	Supports []ImageQuality    `json:"Supports,omitempty" `
	Default  *ImageQuality     `json:"Default,omitempty" `
}

func NewImageQualityConfig() *ImageQualityConfig {
	return &ImageQualityConfig{}
}

func (p *ImageQualityConfig) InitDefault() {
}

var ImageQualityConfig_Switch_DEFAULT *CommonBoolSwitch

func (p *ImageQualityConfig) GetSwitch() (v *CommonBoolSwitch) {
	if !p.IsSetSwitch() {
		return ImageQualityConfig_Switch_DEFAULT
	}
	return p.Switch
}

var ImageQualityConfig_Supports_DEFAULT []ImageQuality

func (p *ImageQualityConfig) GetSupports() (v []ImageQuality) {
	if !p.IsSetSupports() {
		return ImageQualityConfig_Supports_DEFAULT
	}
	return p.Supports
}

var ImageQualityConfig_Default_DEFAULT ImageQuality

func (p *ImageQualityConfig) GetDefault() (v ImageQuality) {
	if !p.IsSetDefault() {
		return ImageQualityConfig_Default_DEFAULT
	}
	return *p.Default
}

func (p *ImageQualityConfig) IsSetSwitch() bool {
	return p.Switch != nil
}

func (p *ImageQualityConfig) IsSetSupports() bool {
	return p.Supports != nil
}

func (p *ImageQualityConfig) IsSetDefault() bool {
	return p.Default != nil
}

func (p *ImageQualityConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ImageQualityConfig(%+v)", *p)
}

// 工具使用配置
type ToolConfig struct {
	WebSearch *CommonBoolSwitch `json:"WebSearch,omitempty" `
}

func NewToolConfig() *ToolConfig {
	return &ToolConfig{}
}

func (p *ToolConfig) InitDefault() {
}

var ToolConfig_WebSearch_DEFAULT *CommonBoolSwitch

func (p *ToolConfig) GetWebSearch() (v *CommonBoolSwitch) {
	if !p.IsSetWebSearch() {
		return ToolConfig_WebSearch_DEFAULT
	}
	return p.WebSearch
}

func (p *ToolConfig) IsSetWebSearch() bool {
	return p.WebSearch != nil
}

func (p *ToolConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ToolConfig(%+v)", *p)
}

// 视频生成配置
type VideoConfig struct {
	// 视频生成支持的分辨率
	Resolutions []string `json:"Resolutions,omitempty" `
	// 视频生成支持的宽高比范围
	Ratio *RatioConfig `json:"Ratio,omitempty" `
	// 视频生成支持的时长范围
	Duration *Duration `json:"Duration,omitempty" `
	// 视频生成支持的相机固定位置开关
	CameraFixed *CommonSwitch `json:"CameraFixed,omitempty" `
	// 图生视频支持的功能开关
	Features []*VisionFeature `json:"Features,omitempty" `
	// 视频生成支持的生成声音开关
	GenerateAudio  *CommonSwitch     `json:"GenerateAudio,omitempty" `
	NegativePrompt *CommonSwitch     `json:"NegativePrompt,omitempty" `
	Watermark      *CommonBoolSwitch `json:"Watermark,omitempty" `
	Reference      *ReferenceConfig  `json:"Reference,omitempty" `
	Tools          *ToolConfig       `json:"Tools,omitempty" `
}

func NewVideoConfig() *VideoConfig {
	return &VideoConfig{}
}

func (p *VideoConfig) InitDefault() {
}

var VideoConfig_Resolutions_DEFAULT []string

func (p *VideoConfig) GetResolutions() (v []string) {
	if !p.IsSetResolutions() {
		return VideoConfig_Resolutions_DEFAULT
	}
	return p.Resolutions
}

var VideoConfig_Ratio_DEFAULT *RatioConfig

func (p *VideoConfig) GetRatio() (v *RatioConfig) {
	if !p.IsSetRatio() {
		return VideoConfig_Ratio_DEFAULT
	}
	return p.Ratio
}

var VideoConfig_Duration_DEFAULT *Duration

func (p *VideoConfig) GetDuration() (v *Duration) {
	if !p.IsSetDuration() {
		return VideoConfig_Duration_DEFAULT
	}
	return p.Duration
}

var VideoConfig_CameraFixed_DEFAULT *CommonSwitch

func (p *VideoConfig) GetCameraFixed() (v *CommonSwitch) {
	if !p.IsSetCameraFixed() {
		return VideoConfig_CameraFixed_DEFAULT
	}
	return p.CameraFixed
}

var VideoConfig_Features_DEFAULT []*VisionFeature

func (p *VideoConfig) GetFeatures() (v []*VisionFeature) {
	if !p.IsSetFeatures() {
		return VideoConfig_Features_DEFAULT
	}
	return p.Features
}

var VideoConfig_GenerateAudio_DEFAULT *CommonSwitch

func (p *VideoConfig) GetGenerateAudio() (v *CommonSwitch) {
	if !p.IsSetGenerateAudio() {
		return VideoConfig_GenerateAudio_DEFAULT
	}
	return p.GenerateAudio
}

var VideoConfig_NegativePrompt_DEFAULT *CommonSwitch

func (p *VideoConfig) GetNegativePrompt() (v *CommonSwitch) {
	if !p.IsSetNegativePrompt() {
		return VideoConfig_NegativePrompt_DEFAULT
	}
	return p.NegativePrompt
}

var VideoConfig_Watermark_DEFAULT *CommonBoolSwitch

func (p *VideoConfig) GetWatermark() (v *CommonBoolSwitch) {
	if !p.IsSetWatermark() {
		return VideoConfig_Watermark_DEFAULT
	}
	return p.Watermark
}

var VideoConfig_Reference_DEFAULT *ReferenceConfig

func (p *VideoConfig) GetReference() (v *ReferenceConfig) {
	if !p.IsSetReference() {
		return VideoConfig_Reference_DEFAULT
	}
	return p.Reference
}

var VideoConfig_Tools_DEFAULT *ToolConfig

func (p *VideoConfig) GetTools() (v *ToolConfig) {
	if !p.IsSetTools() {
		return VideoConfig_Tools_DEFAULT
	}
	return p.Tools
}

func (p *VideoConfig) IsSetResolutions() bool {
	return p.Resolutions != nil
}

func (p *VideoConfig) IsSetRatio() bool {
	return p.Ratio != nil
}

func (p *VideoConfig) IsSetDuration() bool {
	return p.Duration != nil
}

func (p *VideoConfig) IsSetCameraFixed() bool {
	return p.CameraFixed != nil
}

func (p *VideoConfig) IsSetFeatures() bool {
	return p.Features != nil
}

func (p *VideoConfig) IsSetGenerateAudio() bool {
	return p.GenerateAudio != nil
}

func (p *VideoConfig) IsSetNegativePrompt() bool {
	return p.NegativePrompt != nil
}

func (p *VideoConfig) IsSetWatermark() bool {
	return p.Watermark != nil
}

func (p *VideoConfig) IsSetReference() bool {
	return p.Reference != nil
}

func (p *VideoConfig) IsSetTools() bool {
	return p.Tools != nil
}

func (p *VideoConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("VideoConfig(%+v)", *p)
}

type DoubleRange struct {
	Min     *float64      `json:"Min,omitempty" `
	Max     *float64      `json:"Max,omitempty" `
	Default *float64      `json:"Default,omitempty" `
	Switch  *CommonSwitch `json:"Switch,omitempty" `
}

func NewDoubleRange() *DoubleRange {
	return &DoubleRange{}
}

func (p *DoubleRange) InitDefault() {
}

var DoubleRange_Min_DEFAULT float64

func (p *DoubleRange) GetMin() (v float64) {
	if !p.IsSetMin() {
		return DoubleRange_Min_DEFAULT
	}
	return *p.Min
}

var DoubleRange_Max_DEFAULT float64

func (p *DoubleRange) GetMax() (v float64) {
	if !p.IsSetMax() {
		return DoubleRange_Max_DEFAULT
	}
	return *p.Max
}

var DoubleRange_Default_DEFAULT float64

func (p *DoubleRange) GetDefault() (v float64) {
	if !p.IsSetDefault() {
		return DoubleRange_Default_DEFAULT
	}
	return *p.Default
}

var DoubleRange_Switch_DEFAULT *CommonSwitch

func (p *DoubleRange) GetSwitch() (v *CommonSwitch) {
	if !p.IsSetSwitch() {
		return DoubleRange_Switch_DEFAULT
	}
	return p.Switch
}

func (p *DoubleRange) IsSetMin() bool {
	return p.Min != nil
}

func (p *DoubleRange) IsSetMax() bool {
	return p.Max != nil
}

func (p *DoubleRange) IsSetDefault() bool {
	return p.Default != nil
}

func (p *DoubleRange) IsSetSwitch() bool {
	return p.Switch != nil
}

func (p *DoubleRange) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("DoubleRange(%+v)", *p)
}

type IntRange struct {
	Min     *int64        `json:"Min,omitempty" `
	Max     *int64        `json:"Max,omitempty" `
	Default *int64        `json:"Default,omitempty" `
	Switch  *CommonSwitch `json:"Switch,omitempty" `
}

func NewIntRange() *IntRange {
	return &IntRange{}
}

func (p *IntRange) InitDefault() {
}

var IntRange_Min_DEFAULT int64

func (p *IntRange) GetMin() (v int64) {
	if !p.IsSetMin() {
		return IntRange_Min_DEFAULT
	}
	return *p.Min
}

var IntRange_Max_DEFAULT int64

func (p *IntRange) GetMax() (v int64) {
	if !p.IsSetMax() {
		return IntRange_Max_DEFAULT
	}
	return *p.Max
}

var IntRange_Default_DEFAULT int64

func (p *IntRange) GetDefault() (v int64) {
	if !p.IsSetDefault() {
		return IntRange_Default_DEFAULT
	}
	return *p.Default
}

var IntRange_Switch_DEFAULT *CommonSwitch

func (p *IntRange) GetSwitch() (v *CommonSwitch) {
	if !p.IsSetSwitch() {
		return IntRange_Switch_DEFAULT
	}
	return p.Switch
}

func (p *IntRange) IsSetMin() bool {
	return p.Min != nil
}

func (p *IntRange) IsSetMax() bool {
	return p.Max != nil
}

func (p *IntRange) IsSetDefault() bool {
	return p.Default != nil
}

func (p *IntRange) IsSetSwitch() bool {
	return p.Switch != nil
}

func (p *IntRange) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("IntRange(%+v)", *p)
}

type HWConfig struct {
	// 图片生成支持的像素宽度范围
	Width *IntRange `json:"Width,omitempty" `
	// 图片生成支持的像素高度范围
	Height *IntRange `json:"Height,omitempty" `
	// 图片生成支持的宽高比范围
	Ratio *DoubleRange `json:"Ratio,omitempty" `
	// 图片生成支持的像素对
	Pairs [][]int16 `json:"Pairs,omitempty" `
	// 图片生成支持的总像素范围
	Total *IntRange `json:"Total,omitempty" `
}

func NewHWConfig() *HWConfig {
	return &HWConfig{}
}

func (p *HWConfig) InitDefault() {
}

var HWConfig_Width_DEFAULT *IntRange

func (p *HWConfig) GetWidth() (v *IntRange) {
	if !p.IsSetWidth() {
		return HWConfig_Width_DEFAULT
	}
	return p.Width
}

var HWConfig_Height_DEFAULT *IntRange

func (p *HWConfig) GetHeight() (v *IntRange) {
	if !p.IsSetHeight() {
		return HWConfig_Height_DEFAULT
	}
	return p.Height
}

var HWConfig_Ratio_DEFAULT *DoubleRange

func (p *HWConfig) GetRatio() (v *DoubleRange) {
	if !p.IsSetRatio() {
		return HWConfig_Ratio_DEFAULT
	}
	return p.Ratio
}

var HWConfig_Pairs_DEFAULT [][]int16

func (p *HWConfig) GetPairs() (v [][]int16) {
	if !p.IsSetPairs() {
		return HWConfig_Pairs_DEFAULT
	}
	return p.Pairs
}

var HWConfig_Total_DEFAULT *IntRange

func (p *HWConfig) GetTotal() (v *IntRange) {
	if !p.IsSetTotal() {
		return HWConfig_Total_DEFAULT
	}
	return p.Total
}

func (p *HWConfig) IsSetWidth() bool {
	return p.Width != nil
}

func (p *HWConfig) IsSetHeight() bool {
	return p.Height != nil
}

func (p *HWConfig) IsSetRatio() bool {
	return p.Ratio != nil
}

func (p *HWConfig) IsSetPairs() bool {
	return p.Pairs != nil
}

func (p *HWConfig) IsSetTotal() bool {
	return p.Total != nil
}

func (p *HWConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("HWConfig(%+v)", *p)
}

// 图片输入输出配置
type IOConfig struct {
	// 多图输入开关
	Input *CommonSwitch `json:"Input,omitempty" `
	// 输入图片张数配置
	InputConfig *IntRange `json:"InputConfig,omitempty" `
	// 多图输出开关
	Output *CommonSwitch `json:"Output,omitempty" `
	// 输出图片张数配置
	OutputConfig *IntRange `json:"OutputConfig,omitempty" `
}

func NewIOConfig() *IOConfig {
	return &IOConfig{}
}

func (p *IOConfig) InitDefault() {
}

var IOConfig_Input_DEFAULT *CommonSwitch

func (p *IOConfig) GetInput() (v *CommonSwitch) {
	if !p.IsSetInput() {
		return IOConfig_Input_DEFAULT
	}
	return p.Input
}

var IOConfig_InputConfig_DEFAULT *IntRange

func (p *IOConfig) GetInputConfig() (v *IntRange) {
	if !p.IsSetInputConfig() {
		return IOConfig_InputConfig_DEFAULT
	}
	return p.InputConfig
}

var IOConfig_Output_DEFAULT *CommonSwitch

func (p *IOConfig) GetOutput() (v *CommonSwitch) {
	if !p.IsSetOutput() {
		return IOConfig_Output_DEFAULT
	}
	return p.Output
}

var IOConfig_OutputConfig_DEFAULT *IntRange

func (p *IOConfig) GetOutputConfig() (v *IntRange) {
	if !p.IsSetOutputConfig() {
		return IOConfig_OutputConfig_DEFAULT
	}
	return p.OutputConfig
}

func (p *IOConfig) IsSetInput() bool {
	return p.Input != nil
}

func (p *IOConfig) IsSetInputConfig() bool {
	return p.InputConfig != nil
}

func (p *IOConfig) IsSetOutput() bool {
	return p.Output != nil
}

func (p *IOConfig) IsSetOutputConfig() bool {
	return p.OutputConfig != nil
}

func (p *IOConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("IOConfig(%+v)", *p)
}

type ResolutionConfig struct {
	// 图片生成支持的分辨率, 1K\2K\4K
	Values []string      `json:"Values,omitempty" `
	Switch *CommonSwitch `json:"Switch,omitempty" `
}

func NewResolutionConfig() *ResolutionConfig {
	return &ResolutionConfig{}
}

func (p *ResolutionConfig) InitDefault() {
}

var ResolutionConfig_Values_DEFAULT []string

func (p *ResolutionConfig) GetValues() (v []string) {
	if !p.IsSetValues() {
		return ResolutionConfig_Values_DEFAULT
	}
	return p.Values
}

var ResolutionConfig_Switch_DEFAULT *CommonSwitch

func (p *ResolutionConfig) GetSwitch() (v *CommonSwitch) {
	if !p.IsSetSwitch() {
		return ResolutionConfig_Switch_DEFAULT
	}
	return p.Switch
}

func (p *ResolutionConfig) IsSetValues() bool {
	return p.Values != nil
}

func (p *ResolutionConfig) IsSetSwitch() bool {
	return p.Switch != nil
}

func (p *ResolutionConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ResolutionConfig(%+v)", *p)
}

// 图片生成配置
type ImageConfig struct {
	// 文生图
	TextToImage *IOConfig `json:"TextToImage,omitempty" `
	// 图生图
	ImageToImage *IOConfig `json:"ImageToImage,omitempty" `
	// 图片生成支持的宽高像素比配置
	HW             *HWConfig           `json:"HW,omitempty" `
	Resolution     *ResolutionConfig   `json:"Resolution,omitempty" `
	NegativePrompt *CommonSwitch       `json:"NegativePrompt,omitempty" `
	Watermark      *CommonBoolSwitch   `json:"Watermark,omitempty" `
	Tools          *ToolConfig         `json:"Tools,omitempty" `
	Quality        *ImageQualityConfig `json:"Quality,omitempty" `
}

func NewImageConfig() *ImageConfig {
	return &ImageConfig{}
}

func (p *ImageConfig) InitDefault() {
}

var ImageConfig_TextToImage_DEFAULT *IOConfig

func (p *ImageConfig) GetTextToImage() (v *IOConfig) {
	if !p.IsSetTextToImage() {
		return ImageConfig_TextToImage_DEFAULT
	}
	return p.TextToImage
}

var ImageConfig_ImageToImage_DEFAULT *IOConfig

func (p *ImageConfig) GetImageToImage() (v *IOConfig) {
	if !p.IsSetImageToImage() {
		return ImageConfig_ImageToImage_DEFAULT
	}
	return p.ImageToImage
}

var ImageConfig_HW_DEFAULT *HWConfig

func (p *ImageConfig) GetHW() (v *HWConfig) {
	if !p.IsSetHW() {
		return ImageConfig_HW_DEFAULT
	}
	return p.HW
}

var ImageConfig_Resolution_DEFAULT *ResolutionConfig

func (p *ImageConfig) GetResolution() (v *ResolutionConfig) {
	if !p.IsSetResolution() {
		return ImageConfig_Resolution_DEFAULT
	}
	return p.Resolution
}

var ImageConfig_NegativePrompt_DEFAULT *CommonSwitch

func (p *ImageConfig) GetNegativePrompt() (v *CommonSwitch) {
	if !p.IsSetNegativePrompt() {
		return ImageConfig_NegativePrompt_DEFAULT
	}
	return p.NegativePrompt
}

var ImageConfig_Watermark_DEFAULT *CommonBoolSwitch

func (p *ImageConfig) GetWatermark() (v *CommonBoolSwitch) {
	if !p.IsSetWatermark() {
		return ImageConfig_Watermark_DEFAULT
	}
	return p.Watermark
}

var ImageConfig_Tools_DEFAULT *ToolConfig

func (p *ImageConfig) GetTools() (v *ToolConfig) {
	if !p.IsSetTools() {
		return ImageConfig_Tools_DEFAULT
	}
	return p.Tools
}

var ImageConfig_Quality_DEFAULT *ImageQualityConfig

func (p *ImageConfig) GetQuality() (v *ImageQualityConfig) {
	if !p.IsSetQuality() {
		return ImageConfig_Quality_DEFAULT
	}
	return p.Quality
}

func (p *ImageConfig) IsSetTextToImage() bool {
	return p.TextToImage != nil
}

func (p *ImageConfig) IsSetImageToImage() bool {
	return p.ImageToImage != nil
}

func (p *ImageConfig) IsSetHW() bool {
	return p.HW != nil
}

func (p *ImageConfig) IsSetResolution() bool {
	return p.Resolution != nil
}

func (p *ImageConfig) IsSetNegativePrompt() bool {
	return p.NegativePrompt != nil
}

func (p *ImageConfig) IsSetWatermark() bool {
	return p.Watermark != nil
}

func (p *ImageConfig) IsSetTools() bool {
	return p.Tools != nil
}

func (p *ImageConfig) IsSetQuality() bool {
	return p.Quality != nil
}

func (p *ImageConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ImageConfig(%+v)", *p)
}

type VisionFeature struct {
	Name   VisionFeatureName `json:"Name,required" `
	Switch *CommonSwitch     `json:"Switch,omitempty" `
}

func NewVisionFeature() *VisionFeature {
	return &VisionFeature{}
}

func (p *VisionFeature) InitDefault() {
}

func (p *VisionFeature) GetName() (v VisionFeatureName) {
	return p.Name
}

var VisionFeature_Switch_DEFAULT *CommonSwitch

func (p *VisionFeature) GetSwitch() (v *CommonSwitch) {
	if !p.IsSetSwitch() {
		return VisionFeature_Switch_DEFAULT
	}
	return p.Switch
}

func (p *VisionFeature) IsSetSwitch() bool {
	return p.Switch != nil
}

func (p *VisionFeature) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("VisionFeature(%+v)", *p)
}

type VisionConfig struct {
	// 文本权重
	GuidanceScale *DoubleRange `json:"GuidanceScale,omitempty" `
	// 种子值
	Seed *IntRange `json:"Seed,omitempty" `
	// 图片生成配置
	Image *ImageConfig `json:"Image,omitempty" `
	// 视频生成配置
	Video *VideoConfig `json:"Video,omitempty" `
}

func NewVisionConfig() *VisionConfig {
	return &VisionConfig{}
}

func (p *VisionConfig) InitDefault() {
}

var VisionConfig_GuidanceScale_DEFAULT *DoubleRange

func (p *VisionConfig) GetGuidanceScale() (v *DoubleRange) {
	if !p.IsSetGuidanceScale() {
		return VisionConfig_GuidanceScale_DEFAULT
	}
	return p.GuidanceScale
}

var VisionConfig_Seed_DEFAULT *IntRange

func (p *VisionConfig) GetSeed() (v *IntRange) {
	if !p.IsSetSeed() {
		return VisionConfig_Seed_DEFAULT
	}
	return p.Seed
}

var VisionConfig_Image_DEFAULT *ImageConfig

func (p *VisionConfig) GetImage() (v *ImageConfig) {
	if !p.IsSetImage() {
		return VisionConfig_Image_DEFAULT
	}
	return p.Image
}

var VisionConfig_Video_DEFAULT *VideoConfig

func (p *VisionConfig) GetVideo() (v *VideoConfig) {
	if !p.IsSetVideo() {
		return VisionConfig_Video_DEFAULT
	}
	return p.Video
}

func (p *VisionConfig) IsSetGuidanceScale() bool {
	return p.GuidanceScale != nil
}

func (p *VisionConfig) IsSetSeed() bool {
	return p.Seed != nil
}

func (p *VisionConfig) IsSetImage() bool {
	return p.Image != nil
}

func (p *VisionConfig) IsSetVideo() bool {
	return p.Video != nil
}

func (p *VisionConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("VisionConfig(%+v)", *p)
}

type Language struct {
	Code    LanguageCode `json:"Code,required" `
	Content string       `json:"Content,required" `
}

func NewLanguage() *Language {
	return &Language{}
}

func (p *Language) InitDefault() {
}

func (p *Language) GetCode() (v LanguageCode) {
	return p.Code
}

func (p *Language) GetContent() (v string) {
	return p.Content
}

func (p *Language) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("Language(%+v)", *p)
}

type I18NConfig struct {
	// 国际化语言，包含语言code和国际化内容
	Languages []*Language `json:"Languages,omitempty" `
}

func NewI18NConfig() *I18NConfig {
	return &I18NConfig{}
}

func (p *I18NConfig) InitDefault() {
}

var I18NConfig_Languages_DEFAULT []*Language

func (p *I18NConfig) GetLanguages() (v []*Language) {
	if !p.IsSetLanguages() {
		return I18NConfig_Languages_DEFAULT
	}
	return p.Languages
}

func (p *I18NConfig) IsSetLanguages() bool {
	return p.Languages != nil
}

func (p *I18NConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("I18NConfig(%+v)", *p)
}

type VoiceConfig struct {
	// 是否预置
	Preset bool `json:"Preset,required" `
	// 音色
	Voice string `json:"Voice,required" `
	// 音色名称
	Name string `json:"Name,required" `
	// 支持的语言
	SupportedLanguages []string `json:"SupportedLanguages,omitempty" `
	// 名称国际化
	NameI18N *I18NConfig `json:"NameI18N,omitempty" `
}

func NewVoiceConfig() *VoiceConfig {
	return &VoiceConfig{}
}

func (p *VoiceConfig) InitDefault() {
}

func (p *VoiceConfig) GetPreset() (v bool) {
	return p.Preset
}

func (p *VoiceConfig) GetVoice() (v string) {
	return p.Voice
}

func (p *VoiceConfig) GetName() (v string) {
	return p.Name
}

var VoiceConfig_SupportedLanguages_DEFAULT []string

func (p *VoiceConfig) GetSupportedLanguages() (v []string) {
	if !p.IsSetSupportedLanguages() {
		return VoiceConfig_SupportedLanguages_DEFAULT
	}
	return p.SupportedLanguages
}

var VoiceConfig_NameI18N_DEFAULT *I18NConfig

func (p *VoiceConfig) GetNameI18N() (v *I18NConfig) {
	if !p.IsSetNameI18N() {
		return VoiceConfig_NameI18N_DEFAULT
	}
	return p.NameI18N
}

func (p *VoiceConfig) IsSetSupportedLanguages() bool {
	return p.SupportedLanguages != nil
}

func (p *VoiceConfig) IsSetNameI18N() bool {
	return p.NameI18N != nil
}

func (p *VoiceConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("VoiceConfig(%+v)", *p)
}

type MultiVoiceConfig struct {
	// 是否启用
	Enabled bool `json:"Enabled,required" `
	// 音色
	Voices []*VoiceConfig `json:"Voices,omitempty" `
	// 默认音色
	DefaultVoice *string `json:"DefaultVoice,omitempty" `
	// 是否开启国际化
	EnableI18N bool `json:"EnableI18N,required" `
	// 国际化语言
	I18NLanguages []string `json:"I18NLanguages,omitempty" `
}

func NewMultiVoiceConfig() *MultiVoiceConfig {
	return &MultiVoiceConfig{}
}

func (p *MultiVoiceConfig) InitDefault() {
}

func (p *MultiVoiceConfig) GetEnabled() (v bool) {
	return p.Enabled
}

var MultiVoiceConfig_Voices_DEFAULT []*VoiceConfig

func (p *MultiVoiceConfig) GetVoices() (v []*VoiceConfig) {
	if !p.IsSetVoices() {
		return MultiVoiceConfig_Voices_DEFAULT
	}
	return p.Voices
}

var MultiVoiceConfig_DefaultVoice_DEFAULT string

func (p *MultiVoiceConfig) GetDefaultVoice() (v string) {
	if !p.IsSetDefaultVoice() {
		return MultiVoiceConfig_DefaultVoice_DEFAULT
	}
	return *p.DefaultVoice
}

func (p *MultiVoiceConfig) GetEnableI18N() (v bool) {
	return p.EnableI18N
}

var MultiVoiceConfig_I18NLanguages_DEFAULT []string

func (p *MultiVoiceConfig) GetI18NLanguages() (v []string) {
	if !p.IsSetI18NLanguages() {
		return MultiVoiceConfig_I18NLanguages_DEFAULT
	}
	return p.I18NLanguages
}

func (p *MultiVoiceConfig) IsSetVoices() bool {
	return p.Voices != nil
}

func (p *MultiVoiceConfig) IsSetDefaultVoice() bool {
	return p.DefaultVoice != nil
}

func (p *MultiVoiceConfig) IsSetI18NLanguages() bool {
	return p.I18NLanguages != nil
}

func (p *MultiVoiceConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("MultiVoiceConfig(%+v)", *p)
}

type LanguageConfig struct {
	// 是否预置，预置语言不可删除
	Preset bool `json:"Preset,required" `
	// 语言，可以允许为空（表示不传值给模型）
	Language *string `json:"Language,omitempty" `
	// 语言名称
	Name string `json:"Name,required" `
	// 名称国际化
	NameI18N *I18NConfig `json:"NameI18N,omitempty" `
}

func NewLanguageConfig() *LanguageConfig {
	return &LanguageConfig{}
}

func (p *LanguageConfig) InitDefault() {
}

func (p *LanguageConfig) GetPreset() (v bool) {
	return p.Preset
}

var LanguageConfig_Language_DEFAULT string

func (p *LanguageConfig) GetLanguage() (v string) {
	if !p.IsSetLanguage() {
		return LanguageConfig_Language_DEFAULT
	}
	return *p.Language
}

func (p *LanguageConfig) GetName() (v string) {
	return p.Name
}

var LanguageConfig_NameI18N_DEFAULT *I18NConfig

func (p *LanguageConfig) GetNameI18N() (v *I18NConfig) {
	if !p.IsSetNameI18N() {
		return LanguageConfig_NameI18N_DEFAULT
	}
	return p.NameI18N
}

func (p *LanguageConfig) IsSetLanguage() bool {
	return p.Language != nil
}

func (p *LanguageConfig) IsSetNameI18N() bool {
	return p.NameI18N != nil
}

func (p *LanguageConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("LanguageConfig(%+v)", *p)
}

type MultiLanguageConfig struct {
	// 是否启用
	Enabled bool `json:"Enabled,required" `
	// 语言
	Languages []*LanguageConfig `json:"Languages,omitempty" `
	// 默认语言
	DefaultLanguage *string `json:"DefaultLanguage,omitempty" `
	// 是否开启国际化
	EnableI18N bool `json:"EnableI18N,required" `
	// 国际化语言
	I18NLanguages []string `json:"I18NLanguages,omitempty" `
}

func NewMultiLanguageConfig() *MultiLanguageConfig {
	return &MultiLanguageConfig{}
}

func (p *MultiLanguageConfig) InitDefault() {
}

func (p *MultiLanguageConfig) GetEnabled() (v bool) {
	return p.Enabled
}

var MultiLanguageConfig_Languages_DEFAULT []*LanguageConfig

func (p *MultiLanguageConfig) GetLanguages() (v []*LanguageConfig) {
	if !p.IsSetLanguages() {
		return MultiLanguageConfig_Languages_DEFAULT
	}
	return p.Languages
}

var MultiLanguageConfig_DefaultLanguage_DEFAULT string

func (p *MultiLanguageConfig) GetDefaultLanguage() (v string) {
	if !p.IsSetDefaultLanguage() {
		return MultiLanguageConfig_DefaultLanguage_DEFAULT
	}
	return *p.DefaultLanguage
}

func (p *MultiLanguageConfig) GetEnableI18N() (v bool) {
	return p.EnableI18N
}

var MultiLanguageConfig_I18NLanguages_DEFAULT []string

func (p *MultiLanguageConfig) GetI18NLanguages() (v []string) {
	if !p.IsSetI18NLanguages() {
		return MultiLanguageConfig_I18NLanguages_DEFAULT
	}
	return p.I18NLanguages
}

func (p *MultiLanguageConfig) IsSetLanguages() bool {
	return p.Languages != nil
}

func (p *MultiLanguageConfig) IsSetDefaultLanguage() bool {
	return p.DefaultLanguage != nil
}

func (p *MultiLanguageConfig) IsSetI18NLanguages() bool {
	return p.I18NLanguages != nil
}

func (p *MultiLanguageConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("MultiLanguageConfig(%+v)", *p)
}

// TTSConfig TTS配置，多语言、多音色
type TTSConfig struct {
	// 多语言配置
	MultiLanguage *MultiLanguageConfig `json:"MultiLanguage,omitempty" `
	// 多音色配置
	MultiVoice *MultiVoiceConfig `json:"MultiVoice,omitempty" `
}

func NewTTSConfig() *TTSConfig {
	return &TTSConfig{}
}

func (p *TTSConfig) InitDefault() {
}

var TTSConfig_MultiLanguage_DEFAULT *MultiLanguageConfig

func (p *TTSConfig) GetMultiLanguage() (v *MultiLanguageConfig) {
	if !p.IsSetMultiLanguage() {
		return TTSConfig_MultiLanguage_DEFAULT
	}
	return p.MultiLanguage
}

var TTSConfig_MultiVoice_DEFAULT *MultiVoiceConfig

func (p *TTSConfig) GetMultiVoice() (v *MultiVoiceConfig) {
	if !p.IsSetMultiVoice() {
		return TTSConfig_MultiVoice_DEFAULT
	}
	return p.MultiVoice
}

func (p *TTSConfig) IsSetMultiLanguage() bool {
	return p.MultiLanguage != nil
}

func (p *TTSConfig) IsSetMultiVoice() bool {
	return p.MultiVoice != nil
}

func (p *TTSConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("TTSConfig(%+v)", *p)
}

// ASRConfig ASR配置，多语言
type ASRConfig struct {
	// 多语言配置
	MultiLanguage *MultiLanguageConfig `json:"MultiLanguage,omitempty" `
}

func NewASRConfig() *ASRConfig {
	return &ASRConfig{}
}

func (p *ASRConfig) InitDefault() {
}

var ASRConfig_MultiLanguage_DEFAULT *MultiLanguageConfig

func (p *ASRConfig) GetMultiLanguage() (v *MultiLanguageConfig) {
	if !p.IsSetMultiLanguage() {
		return ASRConfig_MultiLanguage_DEFAULT
	}
	return p.MultiLanguage
}

func (p *ASRConfig) IsSetMultiLanguage() bool {
	return p.MultiLanguage != nil
}

func (p *ASRConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ASRConfig(%+v)", *p)
}

// TranscriptionConfig 录音文件识别配置，多语言
type TranscriptionConfig struct {
	// 多语言配置
	MultiLanguage *MultiLanguageConfig `json:"MultiLanguage,omitempty" `
}

func NewTranscriptionConfig() *TranscriptionConfig {
	return &TranscriptionConfig{}
}

func (p *TranscriptionConfig) InitDefault() {
}

var TranscriptionConfig_MultiLanguage_DEFAULT *MultiLanguageConfig

func (p *TranscriptionConfig) GetMultiLanguage() (v *MultiLanguageConfig) {
	if !p.IsSetMultiLanguage() {
		return TranscriptionConfig_MultiLanguage_DEFAULT
	}
	return p.MultiLanguage
}

func (p *TranscriptionConfig) IsSetMultiLanguage() bool {
	return p.MultiLanguage != nil
}

func (p *TranscriptionConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("TranscriptionConfig(%+v)", *p)
}

type AudioConfig struct {
	// TTS配置
	TTS *TTSConfig `json:"TTS,omitempty" `
	// ASR配置
	ASR *ASRConfig `json:"ASR,omitempty" `
	// 录音文件识别配置
	Transcription *TranscriptionConfig `json:"Transcription,omitempty" `
}

func NewAudioConfig() *AudioConfig {
	return &AudioConfig{}
}

func (p *AudioConfig) InitDefault() {
}

var AudioConfig_TTS_DEFAULT *TTSConfig

func (p *AudioConfig) GetTTS() (v *TTSConfig) {
	if !p.IsSetTTS() {
		return AudioConfig_TTS_DEFAULT
	}
	return p.TTS
}

var AudioConfig_ASR_DEFAULT *ASRConfig

func (p *AudioConfig) GetASR() (v *ASRConfig) {
	if !p.IsSetASR() {
		return AudioConfig_ASR_DEFAULT
	}
	return p.ASR
}

var AudioConfig_Transcription_DEFAULT *TranscriptionConfig

func (p *AudioConfig) GetTranscription() (v *TranscriptionConfig) {
	if !p.IsSetTranscription() {
		return AudioConfig_Transcription_DEFAULT
	}
	return p.Transcription
}

func (p *AudioConfig) IsSetTTS() bool {
	return p.TTS != nil
}

func (p *AudioConfig) IsSetASR() bool {
	return p.ASR != nil
}

func (p *AudioConfig) IsSetTranscription() bool {
	return p.Transcription != nil
}

func (p *AudioConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("AudioConfig(%+v)", *p)
}

// SecurityConfig 安全配置
type SecurityConfig struct {
	// 是否开启安全检查
	AICC *CommonBoolSwitch `json:"AICC,omitempty" `
}

func NewSecurityConfig() *SecurityConfig {
	return &SecurityConfig{}
}

func (p *SecurityConfig) InitDefault() {
}

var SecurityConfig_AICC_DEFAULT *CommonBoolSwitch

func (p *SecurityConfig) GetAICC() (v *CommonBoolSwitch) {
	if !p.IsSetAICC() {
		return SecurityConfig_AICC_DEFAULT
	}
	return p.AICC
}

func (p *SecurityConfig) IsSetAICC() bool {
	return p.AICC != nil
}

func (p *SecurityConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("SecurityConfig(%+v)", *p)
}

// CommonModelConfig 公共模型配置
type CommonModelConfig struct {
	// 安全配置
	Security *SecurityConfig `json:"Security,omitempty" `
}

func NewCommonModelConfig() *CommonModelConfig {
	return &CommonModelConfig{}
}

func (p *CommonModelConfig) InitDefault() {
}

var CommonModelConfig_Security_DEFAULT *SecurityConfig

func (p *CommonModelConfig) GetSecurity() (v *SecurityConfig) {
	if !p.IsSetSecurity() {
		return CommonModelConfig_Security_DEFAULT
	}
	return p.Security
}

func (p *CommonModelConfig) IsSetSecurity() bool {
	return p.Security != nil
}

func (p *CommonModelConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CommonModelConfig(%+v)", *p)
}

type APIConfigDetails struct {
	// 是否支持，前端使用
	Supported *bool `json:"Supported,omitempty" `
	// 是否开启，后端使用
	Enabled  *bool          `json:"Enabled,omitempty" `
	Features []ModelFeature `json:"Features,omitempty" `
}

func NewAPIConfigDetails() *APIConfigDetails {
	return &APIConfigDetails{}
}

func (p *APIConfigDetails) InitDefault() {
}

var APIConfigDetails_Supported_DEFAULT bool

func (p *APIConfigDetails) GetSupported() (v bool) {
	if !p.IsSetSupported() {
		return APIConfigDetails_Supported_DEFAULT
	}
	return *p.Supported
}

var APIConfigDetails_Enabled_DEFAULT bool

func (p *APIConfigDetails) GetEnabled() (v bool) {
	if !p.IsSetEnabled() {
		return APIConfigDetails_Enabled_DEFAULT
	}
	return *p.Enabled
}

var APIConfigDetails_Features_DEFAULT []ModelFeature

func (p *APIConfigDetails) GetFeatures() (v []ModelFeature) {
	if !p.IsSetFeatures() {
		return APIConfigDetails_Features_DEFAULT
	}
	return p.Features
}

func (p *APIConfigDetails) IsSetSupported() bool {
	return p.Supported != nil
}

func (p *APIConfigDetails) IsSetEnabled() bool {
	return p.Enabled != nil
}

func (p *APIConfigDetails) IsSetFeatures() bool {
	return p.Features != nil
}

func (p *APIConfigDetails) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("APIConfigDetails(%+v)", *p)
}

// APIConfig API配置
type APIConfig struct {
	// ChatAPI配置，如果没有配置ChatAPI和ResponsesAPI，默认支持ChatAPI
	Chat *APIConfigDetails `json:"Chat,omitempty" `
	// ResponsesAPI配置
	Responses *APIConfigDetails `json:"Responses,omitempty" `
}

func NewAPIConfig() *APIConfig {
	return &APIConfig{}
}

func (p *APIConfig) InitDefault() {
}

var APIConfig_Chat_DEFAULT *APIConfigDetails

func (p *APIConfig) GetChat() (v *APIConfigDetails) {
	if !p.IsSetChat() {
		return APIConfig_Chat_DEFAULT
	}
	return p.Chat
}

var APIConfig_Responses_DEFAULT *APIConfigDetails

func (p *APIConfig) GetResponses() (v *APIConfigDetails) {
	if !p.IsSetResponses() {
		return APIConfig_Responses_DEFAULT
	}
	return p.Responses
}

func (p *APIConfig) IsSetChat() bool {
	return p.Chat != nil
}

func (p *APIConfig) IsSetResponses() bool {
	return p.Responses != nil
}

func (p *APIConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("APIConfig(%+v)", *p)
}

type MaxTokens struct {
	// 最大生成token数最大值
	Max int32 `json:"Max,required" `
	// 最大生成token数最小值
	Min int32 `json:"Min,required" `
	// 最大生成token数默认值
	Default int32 `json:"Default,required" `
}

func NewMaxTokens() *MaxTokens {
	return &MaxTokens{}
}

func (p *MaxTokens) InitDefault() {
}

func (p *MaxTokens) GetMax() (v int32) {
	return p.Max
}

func (p *MaxTokens) GetMin() (v int32) {
	return p.Min
}

func (p *MaxTokens) GetDefault() (v int32) {
	return p.Default
}

func (p *MaxTokens) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("MaxTokens(%+v)", *p)
}

// TokenConfig token配置
type TokenConfig struct {
	// 上下文窗口长度
	ContextTokens *int32 `json:"ContextTokens,omitempty" `
	// 最大生成token数配置
	MaxTokens *MaxTokens `json:"MaxTokens,omitempty" `
}

func NewTokenConfig() *TokenConfig {
	return &TokenConfig{}
}

func (p *TokenConfig) InitDefault() {
}

var TokenConfig_ContextTokens_DEFAULT int32

func (p *TokenConfig) GetContextTokens() (v int32) {
	if !p.IsSetContextTokens() {
		return TokenConfig_ContextTokens_DEFAULT
	}
	return *p.ContextTokens
}

var TokenConfig_MaxTokens_DEFAULT *MaxTokens

func (p *TokenConfig) GetMaxTokens() (v *MaxTokens) {
	if !p.IsSetMaxTokens() {
		return TokenConfig_MaxTokens_DEFAULT
	}
	return p.MaxTokens
}

func (p *TokenConfig) IsSetContextTokens() bool {
	return p.ContextTokens != nil
}

func (p *TokenConfig) IsSetMaxTokens() bool {
	return p.MaxTokens != nil
}

func (p *TokenConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("TokenConfig(%+v)", *p)
}

// ReasoningSwitch 推理开关
type ReasoningSwitch struct {
	// 可选值
	Types []ReasoningSwitchType `json:"Types,omitempty" `
	// 默认值
	DefaultType *ReasoningSwitchType `json:"DefaultType,omitempty" `
}

func NewReasoningSwitch() *ReasoningSwitch {
	return &ReasoningSwitch{}
}

func (p *ReasoningSwitch) InitDefault() {
}

var ReasoningSwitch_Types_DEFAULT []ReasoningSwitchType

func (p *ReasoningSwitch) GetTypes() (v []ReasoningSwitchType) {
	if !p.IsSetTypes() {
		return ReasoningSwitch_Types_DEFAULT
	}
	return p.Types
}

var ReasoningSwitch_DefaultType_DEFAULT ReasoningSwitchType

func (p *ReasoningSwitch) GetDefaultType() (v ReasoningSwitchType) {
	if !p.IsSetDefaultType() {
		return ReasoningSwitch_DefaultType_DEFAULT
	}
	return *p.DefaultType
}

func (p *ReasoningSwitch) IsSetTypes() bool {
	return p.Types != nil
}

func (p *ReasoningSwitch) IsSetDefaultType() bool {
	return p.DefaultType != nil
}

func (p *ReasoningSwitch) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ReasoningSwitch(%+v)", *p)
}

// ReasoningEffort 推理努力程度
// [reasoning models](https://platform.openai.com/docs/guides/reasoning).
type ReasoningEffort struct {
	// 可选值
	Types []ReasoningEffortType `json:"Types,omitempty" `
	// 默认值
	DefaultType *ReasoningEffortType `json:"DefaultType,omitempty" `
}

func NewReasoningEffort() *ReasoningEffort {
	return &ReasoningEffort{}
}

func (p *ReasoningEffort) InitDefault() {
}

var ReasoningEffort_Types_DEFAULT []ReasoningEffortType

func (p *ReasoningEffort) GetTypes() (v []ReasoningEffortType) {
	if !p.IsSetTypes() {
		return ReasoningEffort_Types_DEFAULT
	}
	return p.Types
}

var ReasoningEffort_DefaultType_DEFAULT ReasoningEffortType

func (p *ReasoningEffort) GetDefaultType() (v ReasoningEffortType) {
	if !p.IsSetDefaultType() {
		return ReasoningEffort_DefaultType_DEFAULT
	}
	return *p.DefaultType
}

func (p *ReasoningEffort) IsSetTypes() bool {
	return p.Types != nil
}

func (p *ReasoningEffort) IsSetDefaultType() bool {
	return p.DefaultType != nil
}

func (p *ReasoningEffort) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ReasoningEffort(%+v)", *p)
}

// ReasoningConfig 推理配置
type ReasoningConfig struct {
	// 推理开关
	Switch *ReasoningSwitch `json:"Switch,omitempty" `
	// 推理深度
	Effort *ReasoningEffort `json:"Effort,omitempty" `
}

func NewReasoningConfig() *ReasoningConfig {
	return &ReasoningConfig{}
}

func (p *ReasoningConfig) InitDefault() {
}

var ReasoningConfig_Switch_DEFAULT *ReasoningSwitch

func (p *ReasoningConfig) GetSwitch() (v *ReasoningSwitch) {
	if !p.IsSetSwitch() {
		return ReasoningConfig_Switch_DEFAULT
	}
	return p.Switch
}

var ReasoningConfig_Effort_DEFAULT *ReasoningEffort

func (p *ReasoningConfig) GetEffort() (v *ReasoningEffort) {
	if !p.IsSetEffort() {
		return ReasoningConfig_Effort_DEFAULT
	}
	return p.Effort
}

func (p *ReasoningConfig) IsSetSwitch() bool {
	return p.Switch != nil
}

func (p *ReasoningConfig) IsSetEffort() bool {
	return p.Effort != nil
}

func (p *ReasoningConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ReasoningConfig(%+v)", *p)
}

// 图像理解配置
type ImageUnderstandConfig struct {
	// 是否支持图像理解
	Enabled bool `json:"Enabled,required" `
	// 可选值
	Types []ImageUnderstandType `json:"Types,omitempty" `
	// 默认值
	DefaultType *ImageUnderstandType `json:"DefaultType,omitempty" `
}

func NewImageUnderstandConfig() *ImageUnderstandConfig {
	return &ImageUnderstandConfig{}
}

func (p *ImageUnderstandConfig) InitDefault() {
}

func (p *ImageUnderstandConfig) GetEnabled() (v bool) {
	return p.Enabled
}

var ImageUnderstandConfig_Types_DEFAULT []ImageUnderstandType

func (p *ImageUnderstandConfig) GetTypes() (v []ImageUnderstandType) {
	if !p.IsSetTypes() {
		return ImageUnderstandConfig_Types_DEFAULT
	}
	return p.Types
}

var ImageUnderstandConfig_DefaultType_DEFAULT ImageUnderstandType

func (p *ImageUnderstandConfig) GetDefaultType() (v ImageUnderstandType) {
	if !p.IsSetDefaultType() {
		return ImageUnderstandConfig_DefaultType_DEFAULT
	}
	return *p.DefaultType
}

func (p *ImageUnderstandConfig) IsSetTypes() bool {
	return p.Types != nil
}

func (p *ImageUnderstandConfig) IsSetDefaultType() bool {
	return p.DefaultType != nil
}

func (p *ImageUnderstandConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ImageUnderstandConfig(%+v)", *p)
}

// 视觉理解配置
type VisionUnderstandConfig struct {
	Image *ImageUnderstandConfig `json:"Image,omitempty" `
}

func NewVisionUnderstandConfig() *VisionUnderstandConfig {
	return &VisionUnderstandConfig{}
}

func (p *VisionUnderstandConfig) InitDefault() {
}

var VisionUnderstandConfig_Image_DEFAULT *ImageUnderstandConfig

func (p *VisionUnderstandConfig) GetImage() (v *ImageUnderstandConfig) {
	if !p.IsSetImage() {
		return VisionUnderstandConfig_Image_DEFAULT
	}
	return p.Image
}

func (p *VisionUnderstandConfig) IsSetImage() bool {
	return p.Image != nil
}

func (p *VisionUnderstandConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("VisionUnderstandConfig(%+v)", *p)
}

// ToolCallConfig FunctionCall配置
type ToolCallConfig struct {
	// 是否支持流式FunctionCall
	Streaming *CommonBoolSwitch `json:"Streaming,omitempty" `
}

func NewToolCallConfig() *ToolCallConfig {
	return &ToolCallConfig{}
}

func (p *ToolCallConfig) InitDefault() {
}

var ToolCallConfig_Streaming_DEFAULT *CommonBoolSwitch

func (p *ToolCallConfig) GetStreaming() (v *CommonBoolSwitch) {
	if !p.IsSetStreaming() {
		return ToolCallConfig_Streaming_DEFAULT
	}
	return p.Streaming
}

func (p *ToolCallConfig) IsSetStreaming() bool {
	return p.Streaming != nil
}

func (p *ToolCallConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ToolCallConfig(%+v)", *p)
}

// LLMConfig 大语言模型配置
type LLMConfig struct {
	// API配置
	API *APIConfig `json:"API,omitempty" `
	// token配置
	Token *TokenConfig `json:"Token,omitempty" `
	// 推理配置
	Reasoning *ReasoningConfig `json:"Reasoning,omitempty" `
	// FunctionCall配置
	ToolCall *ToolCallConfig `json:"ToolCall,omitempty" `
	// 图像理解配置
	Vision *VisionUnderstandConfig `json:"Vision,omitempty" `
	// 是否支持流式输出
	Streaming *bool `json:"Streaming,omitempty" `
	// 参数配置
	Parameter *LLMParameterConfig `json:"Parameter,omitempty" `
}

func NewLLMConfig() *LLMConfig {
	return &LLMConfig{}
}

func (p *LLMConfig) InitDefault() {
}

var LLMConfig_API_DEFAULT *APIConfig

func (p *LLMConfig) GetAPI() (v *APIConfig) {
	if !p.IsSetAPI() {
		return LLMConfig_API_DEFAULT
	}
	return p.API
}

var LLMConfig_Token_DEFAULT *TokenConfig

func (p *LLMConfig) GetToken() (v *TokenConfig) {
	if !p.IsSetToken() {
		return LLMConfig_Token_DEFAULT
	}
	return p.Token
}

var LLMConfig_Reasoning_DEFAULT *ReasoningConfig

func (p *LLMConfig) GetReasoning() (v *ReasoningConfig) {
	if !p.IsSetReasoning() {
		return LLMConfig_Reasoning_DEFAULT
	}
	return p.Reasoning
}

var LLMConfig_ToolCall_DEFAULT *ToolCallConfig

func (p *LLMConfig) GetToolCall() (v *ToolCallConfig) {
	if !p.IsSetToolCall() {
		return LLMConfig_ToolCall_DEFAULT
	}
	return p.ToolCall
}

var LLMConfig_Vision_DEFAULT *VisionUnderstandConfig

func (p *LLMConfig) GetVision() (v *VisionUnderstandConfig) {
	if !p.IsSetVision() {
		return LLMConfig_Vision_DEFAULT
	}
	return p.Vision
}

var LLMConfig_Streaming_DEFAULT bool

func (p *LLMConfig) GetStreaming() (v bool) {
	if !p.IsSetStreaming() {
		return LLMConfig_Streaming_DEFAULT
	}
	return *p.Streaming
}

var LLMConfig_Parameter_DEFAULT *LLMParameterConfig

func (p *LLMConfig) GetParameter() (v *LLMParameterConfig) {
	if !p.IsSetParameter() {
		return LLMConfig_Parameter_DEFAULT
	}
	return p.Parameter
}

func (p *LLMConfig) IsSetAPI() bool {
	return p.API != nil
}

func (p *LLMConfig) IsSetToken() bool {
	return p.Token != nil
}

func (p *LLMConfig) IsSetReasoning() bool {
	return p.Reasoning != nil
}

func (p *LLMConfig) IsSetToolCall() bool {
	return p.ToolCall != nil
}

func (p *LLMConfig) IsSetVision() bool {
	return p.Vision != nil
}

func (p *LLMConfig) IsSetStreaming() bool {
	return p.Streaming != nil
}

func (p *LLMConfig) IsSetParameter() bool {
	return p.Parameter != nil
}

func (p *LLMConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("LLMConfig(%+v)", *p)
}

type LLMTemperatureRange struct {
	Min     *float64 `validate:"omitempty,min=0,max=2" json:"Min,omitempty" `
	Max     *float64 `validate:"omitempty,min=0,max=2" json:"Max,omitempty" `
	Default *float64 `validate:"omitempty,min=0,max=2" json:"Default,omitempty" `
}

func NewLLMTemperatureRange() *LLMTemperatureRange {
	return &LLMTemperatureRange{}
}

func (p *LLMTemperatureRange) InitDefault() {
}

var LLMTemperatureRange_Min_DEFAULT float64

func (p *LLMTemperatureRange) GetMin() (v float64) {
	if !p.IsSetMin() {
		return LLMTemperatureRange_Min_DEFAULT
	}
	return *p.Min
}

var LLMTemperatureRange_Max_DEFAULT float64

func (p *LLMTemperatureRange) GetMax() (v float64) {
	if !p.IsSetMax() {
		return LLMTemperatureRange_Max_DEFAULT
	}
	return *p.Max
}

var LLMTemperatureRange_Default_DEFAULT float64

func (p *LLMTemperatureRange) GetDefault() (v float64) {
	if !p.IsSetDefault() {
		return LLMTemperatureRange_Default_DEFAULT
	}
	return *p.Default
}

func (p *LLMTemperatureRange) IsSetMin() bool {
	return p.Min != nil
}

func (p *LLMTemperatureRange) IsSetMax() bool {
	return p.Max != nil
}

func (p *LLMTemperatureRange) IsSetDefault() bool {
	return p.Default != nil
}

func (p *LLMTemperatureRange) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("LLMTemperatureRange(%+v)", *p)
}

type LLMTopPRange struct {
	Min     *float64 `validate:"omitempty,min=0,max=1" json:"Min,omitempty" `
	Max     *float64 `validate:"omitempty,min=0,max=1" json:"Max,omitempty" `
	Default *float64 `validate:"omitempty,min=0,max=1" json:"Default,omitempty" `
}

func NewLLMTopPRange() *LLMTopPRange {
	return &LLMTopPRange{}
}

func (p *LLMTopPRange) InitDefault() {
}

var LLMTopPRange_Min_DEFAULT float64

func (p *LLMTopPRange) GetMin() (v float64) {
	if !p.IsSetMin() {
		return LLMTopPRange_Min_DEFAULT
	}
	return *p.Min
}

var LLMTopPRange_Max_DEFAULT float64

func (p *LLMTopPRange) GetMax() (v float64) {
	if !p.IsSetMax() {
		return LLMTopPRange_Max_DEFAULT
	}
	return *p.Max
}

var LLMTopPRange_Default_DEFAULT float64

func (p *LLMTopPRange) GetDefault() (v float64) {
	if !p.IsSetDefault() {
		return LLMTopPRange_Default_DEFAULT
	}
	return *p.Default
}

func (p *LLMTopPRange) IsSetMin() bool {
	return p.Min != nil
}

func (p *LLMTopPRange) IsSetMax() bool {
	return p.Max != nil
}

func (p *LLMTopPRange) IsSetDefault() bool {
	return p.Default != nil
}

func (p *LLMTopPRange) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("LLMTopPRange(%+v)", *p)
}

type LLMParameterTemplateItem struct {
	Template LLMParameterTemplate `validate:"oneof=remove_top_p remove_stop remove_temperature remove_user rename_max_tokens prompt_role_developer prompt_role_user" json:"Template,required" `
}

func NewLLMParameterTemplateItem() *LLMParameterTemplateItem {
	return &LLMParameterTemplateItem{}
}

func (p *LLMParameterTemplateItem) InitDefault() {
}

func (p *LLMParameterTemplateItem) GetTemplate() (v LLMParameterTemplate) {
	return p.Template
}

func (p *LLMParameterTemplateItem) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("LLMParameterTemplateItem(%+v)", *p)
}

type LLMParameterConfig struct {
	Temperature *LLMTemperatureRange        `json:"Temperature,omitempty" `
	TopP        *LLMTopPRange               `json:"TopP,omitempty" `
	Templates   []*LLMParameterTemplateItem `validate:"omitempty,dive" json:"Templates,omitempty" `
}

func NewLLMParameterConfig() *LLMParameterConfig {
	return &LLMParameterConfig{}
}

func (p *LLMParameterConfig) InitDefault() {
}

var LLMParameterConfig_Temperature_DEFAULT *LLMTemperatureRange

func (p *LLMParameterConfig) GetTemperature() (v *LLMTemperatureRange) {
	if !p.IsSetTemperature() {
		return LLMParameterConfig_Temperature_DEFAULT
	}
	return p.Temperature
}

var LLMParameterConfig_TopP_DEFAULT *LLMTopPRange

func (p *LLMParameterConfig) GetTopP() (v *LLMTopPRange) {
	if !p.IsSetTopP() {
		return LLMParameterConfig_TopP_DEFAULT
	}
	return p.TopP
}

var LLMParameterConfig_Templates_DEFAULT []*LLMParameterTemplateItem

func (p *LLMParameterConfig) GetTemplates() (v []*LLMParameterTemplateItem) {
	if !p.IsSetTemplates() {
		return LLMParameterConfig_Templates_DEFAULT
	}
	return p.Templates
}

func (p *LLMParameterConfig) IsSetTemperature() bool {
	return p.Temperature != nil
}

func (p *LLMParameterConfig) IsSetTopP() bool {
	return p.TopP != nil
}

func (p *LLMParameterConfig) IsSetTemplates() bool {
	return p.Templates != nil
}

func (p *LLMParameterConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("LLMParameterConfig(%+v)", *p)
}

// 向量维度
type HiddenSizeConfig struct {
	Supports []int32 `json:"Supports,omitempty" `
	Default  int32   `json:"Default,required" `
}

func NewHiddenSizeConfig() *HiddenSizeConfig {
	return &HiddenSizeConfig{}
}

func (p *HiddenSizeConfig) InitDefault() {
}

var HiddenSizeConfig_Supports_DEFAULT []int32

func (p *HiddenSizeConfig) GetSupports() (v []int32) {
	if !p.IsSetSupports() {
		return HiddenSizeConfig_Supports_DEFAULT
	}
	return p.Supports
}

func (p *HiddenSizeConfig) GetDefault() (v int32) {
	return p.Default
}

func (p *HiddenSizeConfig) IsSetSupports() bool {
	return p.Supports != nil
}

func (p *HiddenSizeConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("HiddenSizeConfig(%+v)", *p)
}

type InputConfig struct {
	// 总Token长度
	TotalTokens *int32 `json:"TotalTokens,omitempty" `
	// 单条文本输入Token长度
	SingleTextToken *int32 `json:"SingleTextToken,omitempty" `
	// 最大文本数
	MaxTexts *int32 `json:"MaxTexts,omitempty" `
}

func NewInputConfig() *InputConfig {
	return &InputConfig{}
}

func (p *InputConfig) InitDefault() {
}

var InputConfig_TotalTokens_DEFAULT int32

func (p *InputConfig) GetTotalTokens() (v int32) {
	if !p.IsSetTotalTokens() {
		return InputConfig_TotalTokens_DEFAULT
	}
	return *p.TotalTokens
}

var InputConfig_SingleTextToken_DEFAULT int32

func (p *InputConfig) GetSingleTextToken() (v int32) {
	if !p.IsSetSingleTextToken() {
		return InputConfig_SingleTextToken_DEFAULT
	}
	return *p.SingleTextToken
}

var InputConfig_MaxTexts_DEFAULT int32

func (p *InputConfig) GetMaxTexts() (v int32) {
	if !p.IsSetMaxTexts() {
		return InputConfig_MaxTexts_DEFAULT
	}
	return *p.MaxTexts
}

func (p *InputConfig) IsSetTotalTokens() bool {
	return p.TotalTokens != nil
}

func (p *InputConfig) IsSetSingleTextToken() bool {
	return p.SingleTextToken != nil
}

func (p *InputConfig) IsSetMaxTexts() bool {
	return p.MaxTexts != nil
}

func (p *InputConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("InputConfig(%+v)", *p)
}

// QueryInstruction 配置
type QueryInstructionConfig struct {
	// 是否开启 QueryInstruction
	Enabled *bool `json:"Enabled,omitempty" `
	// 生效范围，可选值：*（全部）、knowledgebase（知识库）、faq（问答库）、term（术语库）
	Scope []QueryInstructionScope `validate:"omitempty,dive,oneof=* knowledgebase faq term" json:"Scope,omitempty" `
}

func NewQueryInstructionConfig() *QueryInstructionConfig {
	return &QueryInstructionConfig{}
}

func (p *QueryInstructionConfig) InitDefault() {
}

var QueryInstructionConfig_Enabled_DEFAULT bool

func (p *QueryInstructionConfig) GetEnabled() (v bool) {
	if !p.IsSetEnabled() {
		return QueryInstructionConfig_Enabled_DEFAULT
	}
	return *p.Enabled
}

var QueryInstructionConfig_Scope_DEFAULT []QueryInstructionScope

func (p *QueryInstructionConfig) GetScope() (v []QueryInstructionScope) {
	if !p.IsSetScope() {
		return QueryInstructionConfig_Scope_DEFAULT
	}
	return p.Scope
}

func (p *QueryInstructionConfig) IsSetEnabled() bool {
	return p.Enabled != nil
}

func (p *QueryInstructionConfig) IsSetScope() bool {
	return p.Scope != nil
}

func (p *QueryInstructionConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("QueryInstructionConfig(%+v)", *p)
}

type EmbeddingConfig struct {
	HiddenSize       *HiddenSizeConfig       `json:"HiddenSize,omitempty" `
	Input            *InputConfig            `json:"Input,omitempty" `
	QueryInstruction *QueryInstructionConfig `json:"QueryInstruction,omitempty" `
}

func NewEmbeddingConfig() *EmbeddingConfig {
	return &EmbeddingConfig{}
}

func (p *EmbeddingConfig) InitDefault() {
}

var EmbeddingConfig_HiddenSize_DEFAULT *HiddenSizeConfig

func (p *EmbeddingConfig) GetHiddenSize() (v *HiddenSizeConfig) {
	if !p.IsSetHiddenSize() {
		return EmbeddingConfig_HiddenSize_DEFAULT
	}
	return p.HiddenSize
}

var EmbeddingConfig_Input_DEFAULT *InputConfig

func (p *EmbeddingConfig) GetInput() (v *InputConfig) {
	if !p.IsSetInput() {
		return EmbeddingConfig_Input_DEFAULT
	}
	return p.Input
}

var EmbeddingConfig_QueryInstruction_DEFAULT *QueryInstructionConfig

func (p *EmbeddingConfig) GetQueryInstruction() (v *QueryInstructionConfig) {
	if !p.IsSetQueryInstruction() {
		return EmbeddingConfig_QueryInstruction_DEFAULT
	}
	return p.QueryInstruction
}

func (p *EmbeddingConfig) IsSetHiddenSize() bool {
	return p.HiddenSize != nil
}

func (p *EmbeddingConfig) IsSetInput() bool {
	return p.Input != nil
}

func (p *EmbeddingConfig) IsSetQueryInstruction() bool {
	return p.QueryInstruction != nil
}

func (p *EmbeddingConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("EmbeddingConfig(%+v)", *p)
}

// ModelProperty 模型属性
type ModelProperty struct {
	// 公共配置
	Common *CommonModelConfig `json:"Common,omitempty" `
	// 大语言模型配置
	LLM *LLMConfig `json:"LLM,omitempty" `
	// 嵌入配置
	Embedding *EmbeddingConfig `json:"Embedding,omitempty" `
	// 视觉配置
	Vision *VisionConfig `json:"Vision,omitempty" `
	// 音频配置
	Audio *AudioConfig `json:"Audio,omitempty" `
}

func NewModelProperty() *ModelProperty {
	return &ModelProperty{}
}

func (p *ModelProperty) InitDefault() {
}

var ModelProperty_Common_DEFAULT *CommonModelConfig

func (p *ModelProperty) GetCommon() (v *CommonModelConfig) {
	if !p.IsSetCommon() {
		return ModelProperty_Common_DEFAULT
	}
	return p.Common
}

var ModelProperty_LLM_DEFAULT *LLMConfig

func (p *ModelProperty) GetLLM() (v *LLMConfig) {
	if !p.IsSetLLM() {
		return ModelProperty_LLM_DEFAULT
	}
	return p.LLM
}

var ModelProperty_Embedding_DEFAULT *EmbeddingConfig

func (p *ModelProperty) GetEmbedding() (v *EmbeddingConfig) {
	if !p.IsSetEmbedding() {
		return ModelProperty_Embedding_DEFAULT
	}
	return p.Embedding
}

var ModelProperty_Vision_DEFAULT *VisionConfig

func (p *ModelProperty) GetVision() (v *VisionConfig) {
	if !p.IsSetVision() {
		return ModelProperty_Vision_DEFAULT
	}
	return p.Vision
}

var ModelProperty_Audio_DEFAULT *AudioConfig

func (p *ModelProperty) GetAudio() (v *AudioConfig) {
	if !p.IsSetAudio() {
		return ModelProperty_Audio_DEFAULT
	}
	return p.Audio
}

func (p *ModelProperty) IsSetCommon() bool {
	return p.Common != nil
}

func (p *ModelProperty) IsSetLLM() bool {
	return p.LLM != nil
}

func (p *ModelProperty) IsSetEmbedding() bool {
	return p.Embedding != nil
}

func (p *ModelProperty) IsSetVision() bool {
	return p.Vision != nil
}

func (p *ModelProperty) IsSetAudio() bool {
	return p.Audio != nil
}

func (p *ModelProperty) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ModelProperty(%+v)", *p)
}

// ParameterMapping 模型参数映射
type ParameterMapping struct {
	// 映射类型：rename-重命名，remove-移除
	Type ParameterMappingType `json:"Type,required" `
	// 名称，rename类型必填
	Name *string `json:"Name,omitempty" `
	// 映射值，map类型必填，目前仅支持string
	Value *string `json:"Value,omitempty" `
}

func NewParameterMapping() *ParameterMapping {
	return &ParameterMapping{}
}

func (p *ParameterMapping) InitDefault() {
}

func (p *ParameterMapping) GetType() (v ParameterMappingType) {
	return p.Type
}

var ParameterMapping_Name_DEFAULT string

func (p *ParameterMapping) GetName() (v string) {
	if !p.IsSetName() {
		return ParameterMapping_Name_DEFAULT
	}
	return *p.Name
}

var ParameterMapping_Value_DEFAULT string

func (p *ParameterMapping) GetValue() (v string) {
	if !p.IsSetValue() {
		return ParameterMapping_Value_DEFAULT
	}
	return *p.Value
}

func (p *ParameterMapping) IsSetName() bool {
	return p.Name != nil
}

func (p *ParameterMapping) IsSetValue() bool {
	return p.Value != nil
}

func (p *ParameterMapping) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ParameterMapping(%+v)", *p)
}

// ParameterRule 模型参数规则
type ParameterRule struct {
	// 参数名称，后续可以考虑支持json path
	Name string `json:"Name,required" `
	// 参数路径，支持json path
	Path *string `json:"Path,omitempty" `
	// 参数类型
	Type *ParameterType `json:"Type,omitempty" `
	// 参数是否必填
	Required *bool `json:"Required,omitempty" `
	// 参数默认值
	Default *string `json:"Default,omitempty" `
	// 最大值，浮点数
	Max *string `json:"Max,omitempty" `
	// 最小值，浮点数
	Min *string `json:"Min,omitempty" `
	// 参数映射
	Mapping *ParameterMapping `json:"Mapping,omitempty" `
}

func NewParameterRule() *ParameterRule {
	return &ParameterRule{}
}

func (p *ParameterRule) InitDefault() {
}

func (p *ParameterRule) GetName() (v string) {
	return p.Name
}

var ParameterRule_Path_DEFAULT string

func (p *ParameterRule) GetPath() (v string) {
	if !p.IsSetPath() {
		return ParameterRule_Path_DEFAULT
	}
	return *p.Path
}

var ParameterRule_Type_DEFAULT ParameterType

func (p *ParameterRule) GetType() (v ParameterType) {
	if !p.IsSetType() {
		return ParameterRule_Type_DEFAULT
	}
	return *p.Type
}

var ParameterRule_Required_DEFAULT bool

func (p *ParameterRule) GetRequired() (v bool) {
	if !p.IsSetRequired() {
		return ParameterRule_Required_DEFAULT
	}
	return *p.Required
}

var ParameterRule_Default_DEFAULT string

func (p *ParameterRule) GetDefault() (v string) {
	if !p.IsSetDefault() {
		return ParameterRule_Default_DEFAULT
	}
	return *p.Default
}

var ParameterRule_Max_DEFAULT string

func (p *ParameterRule) GetMax() (v string) {
	if !p.IsSetMax() {
		return ParameterRule_Max_DEFAULT
	}
	return *p.Max
}

var ParameterRule_Min_DEFAULT string

func (p *ParameterRule) GetMin() (v string) {
	if !p.IsSetMin() {
		return ParameterRule_Min_DEFAULT
	}
	return *p.Min
}

var ParameterRule_Mapping_DEFAULT *ParameterMapping

func (p *ParameterRule) GetMapping() (v *ParameterMapping) {
	if !p.IsSetMapping() {
		return ParameterRule_Mapping_DEFAULT
	}
	return p.Mapping
}

func (p *ParameterRule) IsSetPath() bool {
	return p.Path != nil
}

func (p *ParameterRule) IsSetType() bool {
	return p.Type != nil
}

func (p *ParameterRule) IsSetRequired() bool {
	return p.Required != nil
}

func (p *ParameterRule) IsSetDefault() bool {
	return p.Default != nil
}

func (p *ParameterRule) IsSetMax() bool {
	return p.Max != nil
}

func (p *ParameterRule) IsSetMin() bool {
	return p.Min != nil
}

func (p *ParameterRule) IsSetMapping() bool {
	return p.Mapping != nil
}

func (p *ParameterRule) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ParameterRule(%+v)", *p)
}

// ModelParameter 模型参数配置
type ModelParameter struct {
	// 参数规则，适用于completions API
	Rules []*ParameterRule `json:"Rules,omitempty" `
}

func NewModelParameter() *ModelParameter {
	return &ModelParameter{}
}

func (p *ModelParameter) InitDefault() {
}

var ModelParameter_Rules_DEFAULT []*ParameterRule

func (p *ModelParameter) GetRules() (v []*ParameterRule) {
	if !p.IsSetRules() {
		return ModelParameter_Rules_DEFAULT
	}
	return p.Rules
}

func (p *ModelParameter) IsSetRules() bool {
	return p.Rules != nil
}

func (p *ModelParameter) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ModelParameter(%+v)", *p)
}

// CredentialFormSchema 凭证表单 schema
type CredentialFormSchema struct {
	// 变量名
	Name string `json:"Name,required" `
	// 显示label
	Label string `json:"Label,required" `
	// 类型
	Type CredentialFormSchemaType `json:"Type,required" `
	// 是否必填
	Required bool `json:"Required,required" `
	// 默认值
	Default *string `json:"Default,omitempty" `
	// 占位符。text-input 特有的表单项属性，表单项占位符
	Placeholder *string `json:"Placeholder,omitempty" `
	// 选项。select 或 radio 特有的表单项属性，定义下拉内容
	Options []string `json:"Options,omitempty" `
	// 提示信息
	Tips *string `json:"Tips,omitempty" `
	// 最大长度
	MaxLength *int32 `json:"MaxLength,omitempty" `
	// 格式：json-json格式
	Format *CredentialFormSchemaFormat `json:"Format,omitempty" `
	// label国际化配置
	LabelI18N *I18NConfig `json:"LabelI18N,omitempty" `
	// 占位符国际化配置
	PlaceholderI18N *I18NConfig `json:"PlaceholderI18N,omitempty" `
	// 提示信息国际化配置
	TipsI18N *I18NConfig `json:"TipsI18N,omitempty" `
}

func NewCredentialFormSchema() *CredentialFormSchema {
	return &CredentialFormSchema{}
}

func (p *CredentialFormSchema) InitDefault() {
}

func (p *CredentialFormSchema) GetName() (v string) {
	return p.Name
}

func (p *CredentialFormSchema) GetLabel() (v string) {
	return p.Label
}

func (p *CredentialFormSchema) GetType() (v CredentialFormSchemaType) {
	return p.Type
}

func (p *CredentialFormSchema) GetRequired() (v bool) {
	return p.Required
}

var CredentialFormSchema_Default_DEFAULT string

func (p *CredentialFormSchema) GetDefault() (v string) {
	if !p.IsSetDefault() {
		return CredentialFormSchema_Default_DEFAULT
	}
	return *p.Default
}

var CredentialFormSchema_Placeholder_DEFAULT string

func (p *CredentialFormSchema) GetPlaceholder() (v string) {
	if !p.IsSetPlaceholder() {
		return CredentialFormSchema_Placeholder_DEFAULT
	}
	return *p.Placeholder
}

var CredentialFormSchema_Options_DEFAULT []string

func (p *CredentialFormSchema) GetOptions() (v []string) {
	if !p.IsSetOptions() {
		return CredentialFormSchema_Options_DEFAULT
	}
	return p.Options
}

var CredentialFormSchema_Tips_DEFAULT string

func (p *CredentialFormSchema) GetTips() (v string) {
	if !p.IsSetTips() {
		return CredentialFormSchema_Tips_DEFAULT
	}
	return *p.Tips
}

var CredentialFormSchema_MaxLength_DEFAULT int32

func (p *CredentialFormSchema) GetMaxLength() (v int32) {
	if !p.IsSetMaxLength() {
		return CredentialFormSchema_MaxLength_DEFAULT
	}
	return *p.MaxLength
}

var CredentialFormSchema_Format_DEFAULT CredentialFormSchemaFormat

func (p *CredentialFormSchema) GetFormat() (v CredentialFormSchemaFormat) {
	if !p.IsSetFormat() {
		return CredentialFormSchema_Format_DEFAULT
	}
	return *p.Format
}

var CredentialFormSchema_LabelI18N_DEFAULT *I18NConfig

func (p *CredentialFormSchema) GetLabelI18N() (v *I18NConfig) {
	if !p.IsSetLabelI18N() {
		return CredentialFormSchema_LabelI18N_DEFAULT
	}
	return p.LabelI18N
}

var CredentialFormSchema_PlaceholderI18N_DEFAULT *I18NConfig

func (p *CredentialFormSchema) GetPlaceholderI18N() (v *I18NConfig) {
	if !p.IsSetPlaceholderI18N() {
		return CredentialFormSchema_PlaceholderI18N_DEFAULT
	}
	return p.PlaceholderI18N
}

var CredentialFormSchema_TipsI18N_DEFAULT *I18NConfig

func (p *CredentialFormSchema) GetTipsI18N() (v *I18NConfig) {
	if !p.IsSetTipsI18N() {
		return CredentialFormSchema_TipsI18N_DEFAULT
	}
	return p.TipsI18N
}

func (p *CredentialFormSchema) IsSetDefault() bool {
	return p.Default != nil
}

func (p *CredentialFormSchema) IsSetPlaceholder() bool {
	return p.Placeholder != nil
}

func (p *CredentialFormSchema) IsSetOptions() bool {
	return p.Options != nil
}

func (p *CredentialFormSchema) IsSetTips() bool {
	return p.Tips != nil
}

func (p *CredentialFormSchema) IsSetMaxLength() bool {
	return p.MaxLength != nil
}

func (p *CredentialFormSchema) IsSetFormat() bool {
	return p.Format != nil
}

func (p *CredentialFormSchema) IsSetLabelI18N() bool {
	return p.LabelI18N != nil
}

func (p *CredentialFormSchema) IsSetPlaceholderI18N() bool {
	return p.PlaceholderI18N != nil
}

func (p *CredentialFormSchema) IsSetTipsI18N() bool {
	return p.TipsI18N != nil
}

func (p *CredentialFormSchema) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CredentialFormSchema(%+v)", *p)
}

// ModelCredential 模型凭证 schema
type ModelCredentialSchema struct {
	// 模型凭证
	CredentialFormSchemas []*CredentialFormSchema `json:"CredentialFormSchemas,omitempty" `
}

func NewModelCredentialSchema() *ModelCredentialSchema {
	return &ModelCredentialSchema{}
}

func (p *ModelCredentialSchema) InitDefault() {
}

var ModelCredentialSchema_CredentialFormSchemas_DEFAULT []*CredentialFormSchema

func (p *ModelCredentialSchema) GetCredentialFormSchemas() (v []*CredentialFormSchema) {
	if !p.IsSetCredentialFormSchemas() {
		return ModelCredentialSchema_CredentialFormSchemas_DEFAULT
	}
	return p.CredentialFormSchemas
}

func (p *ModelCredentialSchema) IsSetCredentialFormSchemas() bool {
	return p.CredentialFormSchemas != nil
}

func (p *ModelCredentialSchema) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ModelCredentialSchema(%+v)", *p)
}

// 自定义角标
type MarkerDetails struct {
	// 角标文案
	Text string `json:"Text,required" `
	// 角标底色
	Color MarkerColor `json:"Color,required" `
	// 角标悬浮说明
	Description *string `json:"Description,omitempty" `
}

func NewMarkerDetails() *MarkerDetails {
	return &MarkerDetails{}
}

func (p *MarkerDetails) InitDefault() {
}

func (p *MarkerDetails) GetText() (v string) {
	return p.Text
}

func (p *MarkerDetails) GetColor() (v MarkerColor) {
	return p.Color
}

var MarkerDetails_Description_DEFAULT string

func (p *MarkerDetails) GetDescription() (v string) {
	if !p.IsSetDescription() {
		return MarkerDetails_Description_DEFAULT
	}
	return *p.Description
}

func (p *MarkerDetails) IsSetDescription() bool {
	return p.Description != nil
}

func (p *MarkerDetails) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("MarkerDetails(%+v)", *p)
}

// 模型标签
type LabelInfo struct {
	// 标签编码
	Code string `json:"Code,required" `
	// 标签名称
	Name *string `json:"Name,omitempty" `
}

func NewLabelInfo() *LabelInfo {
	return &LabelInfo{}
}

func (p *LabelInfo) InitDefault() {
}

func (p *LabelInfo) GetCode() (v string) {
	return p.Code
}

var LabelInfo_Name_DEFAULT string

func (p *LabelInfo) GetName() (v string) {
	if !p.IsSetName() {
		return LabelInfo_Name_DEFAULT
	}
	return *p.Name
}

func (p *LabelInfo) IsSetName() bool {
	return p.Name != nil
}

func (p *LabelInfo) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("LabelInfo(%+v)", *p)
}

type Usage struct {
	PromptTokens int64 `json:"PromptTokens,required" `
	OutputTokens int64 `json:"OutputTokens,required" `
	TotalTokens  int64 `json:"TotalTokens,required" `
}

func NewUsage() *Usage {
	return &Usage{}
}

func (p *Usage) InitDefault() {
}

func (p *Usage) GetPromptTokens() (v int64) {
	return p.PromptTokens
}

func (p *Usage) GetOutputTokens() (v int64) {
	return p.OutputTokens
}

func (p *Usage) GetTotalTokens() (v int64) {
	return p.TotalTokens
}

func (p *Usage) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("Usage(%+v)", *p)
}

type MaaSModelServiceDeployConfig struct {
	// maas模型ID
	ModelID string `json:"ModelID,required" `
	// maas模型版本ID
	ModelVersionID string `json:"ModelVersionID,required" `
	// maas模型来源
	ModelSource string `json:"ModelSource,required" `
	// 资源池ID
	ResourceID string `json:"ResourceID,required" `
	// 资源名称即算力卡型号
	ResourceName string `json:"ResourceName,required" `
	// 资源配额ID
	ResourceQuotaID string `json:"ResourceQuotaID,required" `
	// 模型服务资源规格配置
	Resource *ModelServiceResource `json:"Resource,required" `
	// 模型服务配置
	Config *ModelServiceConfig `json:"Config,omitempty" `
	// 分布式推理配置
	DistributedInferenceConfig *DistributedInferenceConfig `json:"DistributedInferenceConfig,omitempty" `
	// 资源池类型，当下可分为整卡和虚拟显卡两种类型
	ResourcePoolType string `json:"ResourcePoolType,required" `
}

func NewMaaSModelServiceDeployConfig() *MaaSModelServiceDeployConfig {
	return &MaaSModelServiceDeployConfig{}
}

func (p *MaaSModelServiceDeployConfig) InitDefault() {
}

func (p *MaaSModelServiceDeployConfig) GetModelID() (v string) {
	return p.ModelID
}

func (p *MaaSModelServiceDeployConfig) GetModelVersionID() (v string) {
	return p.ModelVersionID
}

func (p *MaaSModelServiceDeployConfig) GetModelSource() (v string) {
	return p.ModelSource
}

func (p *MaaSModelServiceDeployConfig) GetResourceID() (v string) {
	return p.ResourceID
}

func (p *MaaSModelServiceDeployConfig) GetResourceName() (v string) {
	return p.ResourceName
}

func (p *MaaSModelServiceDeployConfig) GetResourceQuotaID() (v string) {
	return p.ResourceQuotaID
}

var MaaSModelServiceDeployConfig_Resource_DEFAULT *ModelServiceResource

func (p *MaaSModelServiceDeployConfig) GetResource() (v *ModelServiceResource) {
	if !p.IsSetResource() {
		return MaaSModelServiceDeployConfig_Resource_DEFAULT
	}
	return p.Resource
}

var MaaSModelServiceDeployConfig_Config_DEFAULT *ModelServiceConfig

func (p *MaaSModelServiceDeployConfig) GetConfig() (v *ModelServiceConfig) {
	if !p.IsSetConfig() {
		return MaaSModelServiceDeployConfig_Config_DEFAULT
	}
	return p.Config
}

var MaaSModelServiceDeployConfig_DistributedInferenceConfig_DEFAULT *DistributedInferenceConfig

func (p *MaaSModelServiceDeployConfig) GetDistributedInferenceConfig() (v *DistributedInferenceConfig) {
	if !p.IsSetDistributedInferenceConfig() {
		return MaaSModelServiceDeployConfig_DistributedInferenceConfig_DEFAULT
	}
	return p.DistributedInferenceConfig
}

func (p *MaaSModelServiceDeployConfig) GetResourcePoolType() (v string) {
	return p.ResourcePoolType
}

func (p *MaaSModelServiceDeployConfig) IsSetResource() bool {
	return p.Resource != nil
}

func (p *MaaSModelServiceDeployConfig) IsSetConfig() bool {
	return p.Config != nil
}

func (p *MaaSModelServiceDeployConfig) IsSetDistributedInferenceConfig() bool {
	return p.DistributedInferenceConfig != nil
}

func (p *MaaSModelServiceDeployConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("MaaSModelServiceDeployConfig(%+v)", *p)
}

type ModelServiceResource struct {
	// cpu，取值范围：0.01-32
	CPU string `json:"CPU,required" `
	// 内存，取值范围：0.01Gi-128Gi
	Memory string `json:"Memory,required" `
	// gpu卡数，取值范围：1-32
	GPU int32 `validate:"omitempty,min=1,max=32" json:"GPU,required" `
	// 副本数，取值范围：1-100
	Replica int32 `validate:"omitempty,min=1,max=100" json:"Replica,required" `
	// 共享资源池：显存，取值范围：1Gi-128Gi
	GPUMemory *string `json:"GPUMemory,omitempty" `
	// 共享资源池：算力，取值范围：1-100
	GPUCore *int32 `validate:"omitempty,min=1,max=100" json:"GPUCore,omitempty" `
	// 整卡资源池：卡型号
	GPUCardType *string `json:"GPUCardType,omitempty" `
	// LMCache 配置
	LMCacheConfig *LMCacheConfig `json:"LMCacheConfig,omitempty" `
	// MaxRelica 智能弹性伸缩最大副本数，为空表示固定副本数
	MaxReplica *int32 `json:"MaxReplica,omitempty" `
	// PD分离配置
	PdDisaggregationConfig *PdDisaggregationConfig `json:"PdDisaggregationConfig,omitempty" `
}

func NewModelServiceResource() *ModelServiceResource {
	return &ModelServiceResource{}
}

func (p *ModelServiceResource) InitDefault() {
}

func (p *ModelServiceResource) GetCPU() (v string) {
	return p.CPU
}

func (p *ModelServiceResource) GetMemory() (v string) {
	return p.Memory
}

func (p *ModelServiceResource) GetGPU() (v int32) {
	return p.GPU
}

func (p *ModelServiceResource) GetReplica() (v int32) {
	return p.Replica
}

var ModelServiceResource_GPUMemory_DEFAULT string

func (p *ModelServiceResource) GetGPUMemory() (v string) {
	if !p.IsSetGPUMemory() {
		return ModelServiceResource_GPUMemory_DEFAULT
	}
	return *p.GPUMemory
}

var ModelServiceResource_GPUCore_DEFAULT int32

func (p *ModelServiceResource) GetGPUCore() (v int32) {
	if !p.IsSetGPUCore() {
		return ModelServiceResource_GPUCore_DEFAULT
	}
	return *p.GPUCore
}

var ModelServiceResource_GPUCardType_DEFAULT string

func (p *ModelServiceResource) GetGPUCardType() (v string) {
	if !p.IsSetGPUCardType() {
		return ModelServiceResource_GPUCardType_DEFAULT
	}
	return *p.GPUCardType
}

var ModelServiceResource_LMCacheConfig_DEFAULT *LMCacheConfig

func (p *ModelServiceResource) GetLMCacheConfig() (v *LMCacheConfig) {
	if !p.IsSetLMCacheConfig() {
		return ModelServiceResource_LMCacheConfig_DEFAULT
	}
	return p.LMCacheConfig
}

var ModelServiceResource_MaxReplica_DEFAULT int32

func (p *ModelServiceResource) GetMaxReplica() (v int32) {
	if !p.IsSetMaxReplica() {
		return ModelServiceResource_MaxReplica_DEFAULT
	}
	return *p.MaxReplica
}

var ModelServiceResource_PdDisaggregationConfig_DEFAULT *PdDisaggregationConfig

func (p *ModelServiceResource) GetPdDisaggregationConfig() (v *PdDisaggregationConfig) {
	if !p.IsSetPdDisaggregationConfig() {
		return ModelServiceResource_PdDisaggregationConfig_DEFAULT
	}
	return p.PdDisaggregationConfig
}

func (p *ModelServiceResource) IsSetGPUMemory() bool {
	return p.GPUMemory != nil
}

func (p *ModelServiceResource) IsSetGPUCore() bool {
	return p.GPUCore != nil
}

func (p *ModelServiceResource) IsSetGPUCardType() bool {
	return p.GPUCardType != nil
}

func (p *ModelServiceResource) IsSetLMCacheConfig() bool {
	return p.LMCacheConfig != nil
}

func (p *ModelServiceResource) IsSetMaxReplica() bool {
	return p.MaxReplica != nil
}

func (p *ModelServiceResource) IsSetPdDisaggregationConfig() bool {
	return p.PdDisaggregationConfig != nil
}

func (p *ModelServiceResource) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ModelServiceResource(%+v)", *p)
}

type LMCacheConfig struct {
	// 是否开启 LMCache
	Enabled bool `json:"Enabled,required" `
	// 内存，取值范围：0.01Gi-141Gi
	Memory string `json:"Memory" `
}

func NewLMCacheConfig() *LMCacheConfig {
	return &LMCacheConfig{}
}

func (p *LMCacheConfig) InitDefault() {
}

func (p *LMCacheConfig) GetEnabled() (v bool) {
	return p.Enabled
}

func (p *LMCacheConfig) GetMemory() (v string) {
	return p.Memory
}

func (p *LMCacheConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("LMCacheConfig(%+v)", *p)
}

type PdDisaggregationConfig struct {
	PrefillConfig *PdDisaggregationResourceConfig `json:"PrefillConfig,required" `
	DecodeConfig  *PdDisaggregationResourceConfig `json:"DecodeConfig,required" `
	// 是否启用RDMA
	RDMAEnabled bool `json:"RDMAEnabled" `
}

func NewPdDisaggregationConfig() *PdDisaggregationConfig {
	return &PdDisaggregationConfig{}
}

func (p *PdDisaggregationConfig) InitDefault() {
}

var PdDisaggregationConfig_PrefillConfig_DEFAULT *PdDisaggregationResourceConfig

func (p *PdDisaggregationConfig) GetPrefillConfig() (v *PdDisaggregationResourceConfig) {
	if !p.IsSetPrefillConfig() {
		return PdDisaggregationConfig_PrefillConfig_DEFAULT
	}
	return p.PrefillConfig
}

var PdDisaggregationConfig_DecodeConfig_DEFAULT *PdDisaggregationResourceConfig

func (p *PdDisaggregationConfig) GetDecodeConfig() (v *PdDisaggregationResourceConfig) {
	if !p.IsSetDecodeConfig() {
		return PdDisaggregationConfig_DecodeConfig_DEFAULT
	}
	return p.DecodeConfig
}

func (p *PdDisaggregationConfig) GetRDMAEnabled() (v bool) {
	return p.RDMAEnabled
}

func (p *PdDisaggregationConfig) IsSetPrefillConfig() bool {
	return p.PrefillConfig != nil
}

func (p *PdDisaggregationConfig) IsSetDecodeConfig() bool {
	return p.DecodeConfig != nil
}

func (p *PdDisaggregationConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("PdDisaggregationConfig(%+v)", *p)
}

// PD分离Decode配置
type PdDisaggregationResourceConfig struct {
	// cpu，取值范围：0.01-32
	CPU string `json:"CPU,required" `
	// 内存，取值范围：0.01Gi-128Gi
	Memory string `json:"Memory,required" `
	// gpu卡数，取值范围：1-32
	GPU int32 `validate:"omitempty,min=1,max=32" json:"GPU,required" `
	// 卡型号
	GPUCardType string `json:"GPUCardType,required" `
	// 副本数，取值范围：1-100
	Replica int32 `validate:"omitempty,min=1,max=100" json:"Replica,required" `
	// 解码节点数
	NodeNum int32 `validate:"omitempty,min=1,max=100" json:"NodeNum,required" `
}

func NewPdDisaggregationResourceConfig() *PdDisaggregationResourceConfig {
	return &PdDisaggregationResourceConfig{}
}

func (p *PdDisaggregationResourceConfig) InitDefault() {
}

func (p *PdDisaggregationResourceConfig) GetCPU() (v string) {
	return p.CPU
}

func (p *PdDisaggregationResourceConfig) GetMemory() (v string) {
	return p.Memory
}

func (p *PdDisaggregationResourceConfig) GetGPU() (v int32) {
	return p.GPU
}

func (p *PdDisaggregationResourceConfig) GetGPUCardType() (v string) {
	return p.GPUCardType
}

func (p *PdDisaggregationResourceConfig) GetReplica() (v int32) {
	return p.Replica
}

func (p *PdDisaggregationResourceConfig) GetNodeNum() (v int32) {
	return p.NodeNum
}

func (p *PdDisaggregationResourceConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("PdDisaggregationResourceConfig(%+v)", *p)
}

type ModelServiceConfig struct {
	// 量化配置
	Quantization *QuantizationConfig `json:"Quantization,omitempty" `
	// 每分钟请求数，取值范围：1-6000
	RateLimit *RateLimit `json:"RateLimit,omitempty" `
	// 优雅关闭时间，单位：秒
	TerminationGracePeriodSeconds *int64 `json:"TerminationGracePeriodSeconds,omitempty" `
	// 只有支持深度思考模式切换才会存在该字段
	ThinkingModeByDefault *ThinkingModes `json:"ThinkingModeByDefault,omitempty" `
	// 负载均衡策略:
	// 智能负载均衡: Smart
	// 轮询: RoundRobin,
	// 最小队列长度: MinQueueLength
	// 最小显存占用: MinXPUMemory
	// 最小算力占用: MinXPUCore
	LoadBalancePolicy *LoadBalancePolicy `json:"LoadBalancePolicy,omitempty" `
}

func NewModelServiceConfig() *ModelServiceConfig {
	return &ModelServiceConfig{}
}

func (p *ModelServiceConfig) InitDefault() {
}

var ModelServiceConfig_Quantization_DEFAULT *QuantizationConfig

func (p *ModelServiceConfig) GetQuantization() (v *QuantizationConfig) {
	if !p.IsSetQuantization() {
		return ModelServiceConfig_Quantization_DEFAULT
	}
	return p.Quantization
}

var ModelServiceConfig_RateLimit_DEFAULT *RateLimit

func (p *ModelServiceConfig) GetRateLimit() (v *RateLimit) {
	if !p.IsSetRateLimit() {
		return ModelServiceConfig_RateLimit_DEFAULT
	}
	return p.RateLimit
}

var ModelServiceConfig_TerminationGracePeriodSeconds_DEFAULT int64

func (p *ModelServiceConfig) GetTerminationGracePeriodSeconds() (v int64) {
	if !p.IsSetTerminationGracePeriodSeconds() {
		return ModelServiceConfig_TerminationGracePeriodSeconds_DEFAULT
	}
	return *p.TerminationGracePeriodSeconds
}

var ModelServiceConfig_ThinkingModeByDefault_DEFAULT ThinkingModes

func (p *ModelServiceConfig) GetThinkingModeByDefault() (v ThinkingModes) {
	if !p.IsSetThinkingModeByDefault() {
		return ModelServiceConfig_ThinkingModeByDefault_DEFAULT
	}
	return *p.ThinkingModeByDefault
}

var ModelServiceConfig_LoadBalancePolicy_DEFAULT LoadBalancePolicy

func (p *ModelServiceConfig) GetLoadBalancePolicy() (v LoadBalancePolicy) {
	if !p.IsSetLoadBalancePolicy() {
		return ModelServiceConfig_LoadBalancePolicy_DEFAULT
	}
	return *p.LoadBalancePolicy
}

func (p *ModelServiceConfig) IsSetQuantization() bool {
	return p.Quantization != nil
}

func (p *ModelServiceConfig) IsSetRateLimit() bool {
	return p.RateLimit != nil
}

func (p *ModelServiceConfig) IsSetTerminationGracePeriodSeconds() bool {
	return p.TerminationGracePeriodSeconds != nil
}

func (p *ModelServiceConfig) IsSetThinkingModeByDefault() bool {
	return p.ThinkingModeByDefault != nil
}

func (p *ModelServiceConfig) IsSetLoadBalancePolicy() bool {
	return p.LoadBalancePolicy != nil
}

func (p *ModelServiceConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ModelServiceConfig(%+v)", *p)
}

type RateLimit struct {
	// 是否开启限流
	Enabled bool `json:"Enabled,required" `
	// 每分钟请求数，取值范围：1-6000*100
	RPM *int32 `validate:"omitempty,min=1,max=600000" json:"RPM,omitempty" `
}

func NewRateLimit() *RateLimit {
	return &RateLimit{}
}

func (p *RateLimit) InitDefault() {
}

func (p *RateLimit) GetEnabled() (v bool) {
	return p.Enabled
}

var RateLimit_RPM_DEFAULT int32

func (p *RateLimit) GetRPM() (v int32) {
	if !p.IsSetRPM() {
		return RateLimit_RPM_DEFAULT
	}
	return *p.RPM
}

func (p *RateLimit) IsSetRPM() bool {
	return p.RPM != nil
}

func (p *RateLimit) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("RateLimit(%+v)", *p)
}

type QuantizationConfig struct {
	// 是否开启
	Enabled bool `json:"Enabled,required" `
	// 量化类型，取值：
	// transformers: INT8-整数8bit，INT4-整数4bit
	// vllm: FP8-浮点8bit，INT4-整数4bit
	Type *QuantizationType `validate:"omitempty,oneof=INT8 INT4 FP8" json:"Type,omitempty" `
}

func NewQuantizationConfig() *QuantizationConfig {
	return &QuantizationConfig{}
}

func (p *QuantizationConfig) InitDefault() {
}

func (p *QuantizationConfig) GetEnabled() (v bool) {
	return p.Enabled
}

var QuantizationConfig_Type_DEFAULT QuantizationType

func (p *QuantizationConfig) GetType() (v QuantizationType) {
	if !p.IsSetType() {
		return QuantizationConfig_Type_DEFAULT
	}
	return *p.Type
}

func (p *QuantizationConfig) IsSetType() bool {
	return p.Type != nil
}

func (p *QuantizationConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("QuantizationConfig(%+v)", *p)
}

type DistributedInferenceConfig struct {
	// 节点数
	NodeNum int32 `json:"NodeNum,required" `
	// 是否启用RDMA
	RDMAEnabled bool `json:"RDMAEnabled" `
	// 是否启用分布式推理
	Enabled bool `json:"Enabled" `
}

func NewDistributedInferenceConfig() *DistributedInferenceConfig {
	return &DistributedInferenceConfig{}
}

func (p *DistributedInferenceConfig) InitDefault() {
}

func (p *DistributedInferenceConfig) GetNodeNum() (v int32) {
	return p.NodeNum
}

func (p *DistributedInferenceConfig) GetRDMAEnabled() (v bool) {
	return p.RDMAEnabled
}

func (p *DistributedInferenceConfig) GetEnabled() (v bool) {
	return p.Enabled
}

func (p *DistributedInferenceConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("DistributedInferenceConfig(%+v)", *p)
}
