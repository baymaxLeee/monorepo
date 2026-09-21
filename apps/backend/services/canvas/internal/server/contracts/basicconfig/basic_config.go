package basicconfig

import (
	"fmt"
	"github.com/example/monorepo/canvas/internal/server/contracts/base"
)

// ModelConfig 是 AgentFrame 可透传给推理请求的默认调优参数。
type ModelConfig struct {
	Temperature         *float64 `json:"Temperature,omitempty"`
	TopP                *float64 `json:"TopP,omitempty"`
	MaxTokens           *int64   `json:"MaxTokens,omitempty"`
	ReasoningEffortType *string  `json:"ReasoningEffortType,omitempty"`
}

func NewModelConfig() *ModelConfig {
	return &ModelConfig{}
}

func (p *ModelConfig) InitDefault() {
}

var ModelConfig_Temperature_DEFAULT float64

func (p *ModelConfig) GetTemperature() (v float64) {
	if !p.IsSetTemperature() {
		return ModelConfig_Temperature_DEFAULT
	}
	return *p.Temperature
}

var ModelConfig_TopP_DEFAULT float64

func (p *ModelConfig) GetTopP() (v float64) {
	if !p.IsSetTopP() {
		return ModelConfig_TopP_DEFAULT
	}
	return *p.TopP
}

var ModelConfig_MaxTokens_DEFAULT int64

func (p *ModelConfig) GetMaxTokens() (v int64) {
	if !p.IsSetMaxTokens() {
		return ModelConfig_MaxTokens_DEFAULT
	}
	return *p.MaxTokens
}

var ModelConfig_ReasoningEffortType_DEFAULT string

func (p *ModelConfig) GetReasoningEffortType() (v string) {
	if !p.IsSetReasoningEffortType() {
		return ModelConfig_ReasoningEffortType_DEFAULT
	}
	return *p.ReasoningEffortType
}

func (p *ModelConfig) IsSetTemperature() bool {
	return p.Temperature != nil
}

func (p *ModelConfig) IsSetTopP() bool {
	return p.TopP != nil
}

func (p *ModelConfig) IsSetMaxTokens() bool {
	return p.MaxTokens != nil
}

func (p *ModelConfig) IsSetReasoningEffortType() bool {
	return p.ReasoningEffortType != nil
}

func (p *ModelConfig) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ModelConfig(%+v)", *p)
}

// ModelSelection 是默认模型身份及其请求参数。
type ModelSelection struct {
	ModelID     string       `json:"ModelID"`
	ModelConfig *ModelConfig `json:"ModelConfig"`
}

func NewModelSelection() *ModelSelection {
	return &ModelSelection{}
}

func (p *ModelSelection) InitDefault() {
}

func (p *ModelSelection) GetModelID() (v string) {
	return p.ModelID
}

var ModelSelection_ModelConfig_DEFAULT *ModelConfig

func (p *ModelSelection) GetModelConfig() (v *ModelConfig) {
	if !p.IsSetModelConfig() {
		return ModelSelection_ModelConfig_DEFAULT
	}
	return p.ModelConfig
}

func (p *ModelSelection) IsSetModelConfig() bool {
	return p.ModelConfig != nil
}

func (p *ModelSelection) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ModelSelection(%+v)", *p)
}

// DefaultModels 是 AgentFrame 当前租户的完整默认模型配置。
type DefaultModels struct {
	InferenceModel *ModelSelection `json:"InferenceModel"`
	ImageModel     *ModelSelection `json:"ImageModel"`
	VideoModel     *ModelSelection `json:"VideoModel"`
}

func NewDefaultModels() *DefaultModels {
	return &DefaultModels{}
}

func (p *DefaultModels) InitDefault() {
}

var DefaultModels_InferenceModel_DEFAULT *ModelSelection

func (p *DefaultModels) GetInferenceModel() (v *ModelSelection) {
	if !p.IsSetInferenceModel() {
		return DefaultModels_InferenceModel_DEFAULT
	}
	return p.InferenceModel
}

var DefaultModels_ImageModel_DEFAULT *ModelSelection

func (p *DefaultModels) GetImageModel() (v *ModelSelection) {
	if !p.IsSetImageModel() {
		return DefaultModels_ImageModel_DEFAULT
	}
	return p.ImageModel
}

var DefaultModels_VideoModel_DEFAULT *ModelSelection

func (p *DefaultModels) GetVideoModel() (v *ModelSelection) {
	if !p.IsSetVideoModel() {
		return DefaultModels_VideoModel_DEFAULT
	}
	return p.VideoModel
}

func (p *DefaultModels) IsSetInferenceModel() bool {
	return p.InferenceModel != nil
}

func (p *DefaultModels) IsSetImageModel() bool {
	return p.ImageModel != nil
}

func (p *DefaultModels) IsSetVideoModel() bool {
	return p.VideoModel != nil
}

func (p *DefaultModels) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("DefaultModels(%+v)", *p)
}

type GetBasicConfigRequest struct {
	Top *base.TopParam `json:"Top,omitempty"`
}

func NewGetBasicConfigRequest() *GetBasicConfigRequest {
	return &GetBasicConfigRequest{}
}

func (p *GetBasicConfigRequest) InitDefault() {
}

var GetBasicConfigRequest_Top_DEFAULT *base.TopParam

func (p *GetBasicConfigRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return GetBasicConfigRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *GetBasicConfigRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *GetBasicConfigRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("GetBasicConfigRequest(%+v)", *p)
}

type GetBasicConfigResponse struct {
	DefaultModels *DefaultModels `json:"DefaultModels"`
}

func NewGetBasicConfigResponse() *GetBasicConfigResponse {
	return &GetBasicConfigResponse{}
}

func (p *GetBasicConfigResponse) InitDefault() {
}

var GetBasicConfigResponse_DefaultModels_DEFAULT *DefaultModels

func (p *GetBasicConfigResponse) GetDefaultModels() (v *DefaultModels) {
	if !p.IsSetDefaultModels() {
		return GetBasicConfigResponse_DefaultModels_DEFAULT
	}
	return p.DefaultModels
}

func (p *GetBasicConfigResponse) IsSetDefaultModels() bool {
	return p.DefaultModels != nil
}

func (p *GetBasicConfigResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("GetBasicConfigResponse(%+v)", *p)
}

type UpdateBasicConfigRequest struct {
	DefaultModels *DefaultModels `json:"DefaultModels"`
	Top           *base.TopParam `json:"Top,omitempty"`
}

func NewUpdateBasicConfigRequest() *UpdateBasicConfigRequest {
	return &UpdateBasicConfigRequest{}
}

func (p *UpdateBasicConfigRequest) InitDefault() {
}

var UpdateBasicConfigRequest_DefaultModels_DEFAULT *DefaultModels

func (p *UpdateBasicConfigRequest) GetDefaultModels() (v *DefaultModels) {
	if !p.IsSetDefaultModels() {
		return UpdateBasicConfigRequest_DefaultModels_DEFAULT
	}
	return p.DefaultModels
}

var UpdateBasicConfigRequest_Top_DEFAULT *base.TopParam

func (p *UpdateBasicConfigRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return UpdateBasicConfigRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *UpdateBasicConfigRequest) IsSetDefaultModels() bool {
	return p.DefaultModels != nil
}

func (p *UpdateBasicConfigRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *UpdateBasicConfigRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("UpdateBasicConfigRequest(%+v)", *p)
}

type UpdateBasicConfigResponse struct {
	DefaultModels *DefaultModels `json:"DefaultModels"`
}

func NewUpdateBasicConfigResponse() *UpdateBasicConfigResponse {
	return &UpdateBasicConfigResponse{}
}

func (p *UpdateBasicConfigResponse) InitDefault() {
}

var UpdateBasicConfigResponse_DefaultModels_DEFAULT *DefaultModels

func (p *UpdateBasicConfigResponse) GetDefaultModels() (v *DefaultModels) {
	if !p.IsSetDefaultModels() {
		return UpdateBasicConfigResponse_DefaultModels_DEFAULT
	}
	return p.DefaultModels
}

func (p *UpdateBasicConfigResponse) IsSetDefaultModels() bool {
	return p.DefaultModels != nil
}

func (p *UpdateBasicConfigResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("UpdateBasicConfigResponse(%+v)", *p)
}
