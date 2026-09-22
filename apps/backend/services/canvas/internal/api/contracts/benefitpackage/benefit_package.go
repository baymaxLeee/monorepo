package benefitpackage

import (
	"database/sql"
	"database/sql/driver"
	"fmt"

	"github.com/example/monorepo/canvas/internal/api/contracts/common"
)

type BenefitPackageScopeType int64

const (
	BenefitPackageScopeType_CUSTOM_MODELS        BenefitPackageScopeType = 1
	BenefitPackageScopeType_SYSTEM_PRESET_MODELS BenefitPackageScopeType = 2
)

func (p BenefitPackageScopeType) String() string {
	switch p {
	case BenefitPackageScopeType_CUSTOM_MODELS:
		return "CUSTOM_MODELS"
	case BenefitPackageScopeType_SYSTEM_PRESET_MODELS:
		return "SYSTEM_PRESET_MODELS"
	}
	return "<UNSET>"
}

func BenefitPackageScopeTypeFromString(s string) (BenefitPackageScopeType, error) {
	switch s {
	case "CUSTOM_MODELS":
		return BenefitPackageScopeType_CUSTOM_MODELS, nil
	case "SYSTEM_PRESET_MODELS":
		return BenefitPackageScopeType_SYSTEM_PRESET_MODELS, nil
	}
	return BenefitPackageScopeType(0), fmt.Errorf("not a valid BenefitPackageScopeType string")
}

func BenefitPackageScopeTypePtr(v BenefitPackageScopeType) *BenefitPackageScopeType { return &v }
func (p *BenefitPackageScopeType) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = BenefitPackageScopeType(result.Int64)
	return
}

func (p *BenefitPackageScopeType) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

// BenefitPackage 是高级创作使用的权益包。预置与自定义权益包共享同一数据模型。
type BenefitPackage struct {
	PackageID   string `json:"PackageID"`
	IsPreset    bool   `json:"IsPreset"`
	Name        string `json:"Name"`
	ProjectName string `json:"ProjectName"`
	// HasAccessKeyID 仅表示 AK 已配置；服务端永不返回明文或密文。
	HasAccessKeyID bool `json:"HasAccessKeyID"`
	// HasSecretAccessKey 仅表示密钥已配置；服务端永不返回 Secret Access Key 明文或密文。
	HasSecretAccessKey bool `json:"HasSecretAccessKey"`
	Enabled            bool `json:"Enabled"`
	// ModelIDs 仅用于自定义权益包，逐项保存生效的视频模型。
	ModelIDs []string `json:"ModelIDs"`
	// MaterialUsed 是使用该权益包完成送审的素材数量，只读且由送审记录聚合得到。
	MaterialUsed int64            `json:"MaterialUsed"`
	Revision     int64            `json:"Revision"`
	CreatedBy    string           `json:"CreatedBy"`
	UpdatedBy    string           `json:"UpdatedBy"`
	CreatedAt    common.Timestamp `json:"CreatedAt"`
	UpdatedAt    common.Timestamp `json:"UpdatedAt"`
	// SYSTEM_PRESET_MODELS 是动态范围，自动覆盖当前及未来全部系统预制模型。
	ScopeType BenefitPackageScopeType `json:"ScopeType"`
}

func NewBenefitPackage() *BenefitPackage {
	return &BenefitPackage{}
}

func (p *BenefitPackage) InitDefault() {
}

func (p *BenefitPackage) GetPackageID() (v string) {
	return p.PackageID
}

func (p *BenefitPackage) GetIsPreset() (v bool) {
	return p.IsPreset
}

func (p *BenefitPackage) GetName() (v string) {
	return p.Name
}

func (p *BenefitPackage) GetProjectName() (v string) {
	return p.ProjectName
}

func (p *BenefitPackage) GetHasAccessKeyID() (v bool) {
	return p.HasAccessKeyID
}

func (p *BenefitPackage) GetHasSecretAccessKey() (v bool) {
	return p.HasSecretAccessKey
}

func (p *BenefitPackage) GetEnabled() (v bool) {
	return p.Enabled
}

func (p *BenefitPackage) GetModelIDs() (v []string) {
	return p.ModelIDs
}

func (p *BenefitPackage) GetMaterialUsed() (v int64) {
	return p.MaterialUsed
}

func (p *BenefitPackage) GetRevision() (v int64) {
	return p.Revision
}

func (p *BenefitPackage) GetCreatedBy() (v string) {
	return p.CreatedBy
}

func (p *BenefitPackage) GetUpdatedBy() (v string) {
	return p.UpdatedBy
}

func (p *BenefitPackage) GetCreatedAt() (v common.Timestamp) {
	return p.CreatedAt
}

func (p *BenefitPackage) GetUpdatedAt() (v common.Timestamp) {
	return p.UpdatedAt
}

func (p *BenefitPackage) GetScopeType() (v BenefitPackageScopeType) {
	return p.ScopeType
}

func (p *BenefitPackage) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("BenefitPackage(%+v)", *p)
}

type ListAvailableBenefitPackagesRequest struct {
}

func NewListAvailableBenefitPackagesRequest() *ListAvailableBenefitPackagesRequest {
	return &ListAvailableBenefitPackagesRequest{}
}

func (p *ListAvailableBenefitPackagesRequest) InitDefault() {
}

func (p *ListAvailableBenefitPackagesRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ListAvailableBenefitPackagesRequest(%+v)", *p)
}

type ListAvailableBenefitPackagesResponse struct {
	Items []*BenefitPackage `json:"Items"`
}

func NewListAvailableBenefitPackagesResponse() *ListAvailableBenefitPackagesResponse {
	return &ListAvailableBenefitPackagesResponse{}
}

func (p *ListAvailableBenefitPackagesResponse) InitDefault() {
}

func (p *ListAvailableBenefitPackagesResponse) GetItems() (v []*BenefitPackage) {
	return p.Items
}

func (p *ListAvailableBenefitPackagesResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ListAvailableBenefitPackagesResponse(%+v)", *p)
}

type CreatePresetBenefitPackageRequest struct {
	AccessKeyID     string `json:"AccessKeyID"`
	SecretAccessKey string `json:"SecretAccessKey"`
}

func NewCreatePresetBenefitPackageRequest() *CreatePresetBenefitPackageRequest {
	return &CreatePresetBenefitPackageRequest{}
}

func (p *CreatePresetBenefitPackageRequest) InitDefault() {
}

func (p *CreatePresetBenefitPackageRequest) GetAccessKeyID() (v string) {
	return p.AccessKeyID
}

func (p *CreatePresetBenefitPackageRequest) GetSecretAccessKey() (v string) {
	return p.SecretAccessKey
}

func (p *CreatePresetBenefitPackageRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CreatePresetBenefitPackageRequest(%+v)", *p)
}

type CreatePresetBenefitPackageResponse struct {
	Package *BenefitPackage `json:"Package"`
}

func NewCreatePresetBenefitPackageResponse() *CreatePresetBenefitPackageResponse {
	return &CreatePresetBenefitPackageResponse{}
}

func (p *CreatePresetBenefitPackageResponse) InitDefault() {
}

var CreatePresetBenefitPackageResponse_Package_DEFAULT *BenefitPackage

func (p *CreatePresetBenefitPackageResponse) GetPackage() (v *BenefitPackage) {
	if !p.IsSetPackage() {
		return CreatePresetBenefitPackageResponse_Package_DEFAULT
	}
	return p.Package
}

func (p *CreatePresetBenefitPackageResponse) IsSetPackage() bool {
	return p.Package != nil
}

func (p *CreatePresetBenefitPackageResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CreatePresetBenefitPackageResponse(%+v)", *p)
}

type UpdatePresetBenefitPackageRequest struct {
	PackageID string `json:"PackageID"`
	// AccessKeyID 和 SecretAccessKey 省略时分别保留现有密钥。
	AccessKeyID      *string `json:"AccessKeyID,omitempty"`
	SecretAccessKey  *string `json:"SecretAccessKey,omitempty"`
	ExpectedRevision int64   `json:"ExpectedRevision"`
}

func NewUpdatePresetBenefitPackageRequest() *UpdatePresetBenefitPackageRequest {
	return &UpdatePresetBenefitPackageRequest{}
}

func (p *UpdatePresetBenefitPackageRequest) InitDefault() {
}

func (p *UpdatePresetBenefitPackageRequest) GetPackageID() (v string) {
	return p.PackageID
}

var UpdatePresetBenefitPackageRequest_AccessKeyID_DEFAULT string

func (p *UpdatePresetBenefitPackageRequest) GetAccessKeyID() (v string) {
	if !p.IsSetAccessKeyID() {
		return UpdatePresetBenefitPackageRequest_AccessKeyID_DEFAULT
	}
	return *p.AccessKeyID
}

var UpdatePresetBenefitPackageRequest_SecretAccessKey_DEFAULT string

func (p *UpdatePresetBenefitPackageRequest) GetSecretAccessKey() (v string) {
	if !p.IsSetSecretAccessKey() {
		return UpdatePresetBenefitPackageRequest_SecretAccessKey_DEFAULT
	}
	return *p.SecretAccessKey
}

func (p *UpdatePresetBenefitPackageRequest) GetExpectedRevision() (v int64) {
	return p.ExpectedRevision
}

func (p *UpdatePresetBenefitPackageRequest) IsSetAccessKeyID() bool {
	return p.AccessKeyID != nil
}

func (p *UpdatePresetBenefitPackageRequest) IsSetSecretAccessKey() bool {
	return p.SecretAccessKey != nil
}

func (p *UpdatePresetBenefitPackageRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("UpdatePresetBenefitPackageRequest(%+v)", *p)
}

type UpdatePresetBenefitPackageResponse struct {
	Package *BenefitPackage `json:"Package"`
}

func NewUpdatePresetBenefitPackageResponse() *UpdatePresetBenefitPackageResponse {
	return &UpdatePresetBenefitPackageResponse{}
}

func (p *UpdatePresetBenefitPackageResponse) InitDefault() {
}

var UpdatePresetBenefitPackageResponse_Package_DEFAULT *BenefitPackage

func (p *UpdatePresetBenefitPackageResponse) GetPackage() (v *BenefitPackage) {
	if !p.IsSetPackage() {
		return UpdatePresetBenefitPackageResponse_Package_DEFAULT
	}
	return p.Package
}

func (p *UpdatePresetBenefitPackageResponse) IsSetPackage() bool {
	return p.Package != nil
}

func (p *UpdatePresetBenefitPackageResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("UpdatePresetBenefitPackageResponse(%+v)", *p)
}

type SetPresetBenefitPackageEnabledRequest struct {
	PackageID        string `json:"PackageID"`
	Enabled          bool   `json:"Enabled"`
	ExpectedRevision int64  `json:"ExpectedRevision"`
}

func NewSetPresetBenefitPackageEnabledRequest() *SetPresetBenefitPackageEnabledRequest {
	return &SetPresetBenefitPackageEnabledRequest{}
}

func (p *SetPresetBenefitPackageEnabledRequest) InitDefault() {
}

func (p *SetPresetBenefitPackageEnabledRequest) GetPackageID() (v string) {
	return p.PackageID
}

func (p *SetPresetBenefitPackageEnabledRequest) GetEnabled() (v bool) {
	return p.Enabled
}

func (p *SetPresetBenefitPackageEnabledRequest) GetExpectedRevision() (v int64) {
	return p.ExpectedRevision
}

func (p *SetPresetBenefitPackageEnabledRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("SetPresetBenefitPackageEnabledRequest(%+v)", *p)
}

type SetPresetBenefitPackageEnabledResponse struct {
	Package *BenefitPackage `json:"Package"`
}

func NewSetPresetBenefitPackageEnabledResponse() *SetPresetBenefitPackageEnabledResponse {
	return &SetPresetBenefitPackageEnabledResponse{}
}

func (p *SetPresetBenefitPackageEnabledResponse) InitDefault() {
}

var SetPresetBenefitPackageEnabledResponse_Package_DEFAULT *BenefitPackage

func (p *SetPresetBenefitPackageEnabledResponse) GetPackage() (v *BenefitPackage) {
	if !p.IsSetPackage() {
		return SetPresetBenefitPackageEnabledResponse_Package_DEFAULT
	}
	return p.Package
}

func (p *SetPresetBenefitPackageEnabledResponse) IsSetPackage() bool {
	return p.Package != nil
}

func (p *SetPresetBenefitPackageEnabledResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("SetPresetBenefitPackageEnabledResponse(%+v)", *p)
}

type ListCustomBenefitPackagesRequest struct {
}

func NewListCustomBenefitPackagesRequest() *ListCustomBenefitPackagesRequest {
	return &ListCustomBenefitPackagesRequest{}
}

func (p *ListCustomBenefitPackagesRequest) InitDefault() {
}

func (p *ListCustomBenefitPackagesRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ListCustomBenefitPackagesRequest(%+v)", *p)
}

type ListCustomBenefitPackagesResponse struct {
	Items []*BenefitPackage `json:"Items"`
}

func NewListCustomBenefitPackagesResponse() *ListCustomBenefitPackagesResponse {
	return &ListCustomBenefitPackagesResponse{}
}

func (p *ListCustomBenefitPackagesResponse) InitDefault() {
}

func (p *ListCustomBenefitPackagesResponse) GetItems() (v []*BenefitPackage) {
	return p.Items
}

func (p *ListCustomBenefitPackagesResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("ListCustomBenefitPackagesResponse(%+v)", *p)
}

type CreateCustomBenefitPackageRequest struct {
	Name            string   `json:"Name"`
	ProjectName     string   `json:"ProjectName"`
	AccessKeyID     string   `json:"AccessKeyID"`
	SecretAccessKey string   `json:"SecretAccessKey"`
	Enabled         bool     `json:"Enabled"`
	ModelIDs        []string `json:"ModelIDs"`
}

func NewCreateCustomBenefitPackageRequest() *CreateCustomBenefitPackageRequest {
	return &CreateCustomBenefitPackageRequest{}
}

func (p *CreateCustomBenefitPackageRequest) InitDefault() {
}

func (p *CreateCustomBenefitPackageRequest) GetName() (v string) {
	return p.Name
}

func (p *CreateCustomBenefitPackageRequest) GetProjectName() (v string) {
	return p.ProjectName
}

func (p *CreateCustomBenefitPackageRequest) GetAccessKeyID() (v string) {
	return p.AccessKeyID
}

func (p *CreateCustomBenefitPackageRequest) GetSecretAccessKey() (v string) {
	return p.SecretAccessKey
}

func (p *CreateCustomBenefitPackageRequest) GetEnabled() (v bool) {
	return p.Enabled
}

func (p *CreateCustomBenefitPackageRequest) GetModelIDs() (v []string) {
	return p.ModelIDs
}

func (p *CreateCustomBenefitPackageRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CreateCustomBenefitPackageRequest(%+v)", *p)
}

type CreateCustomBenefitPackageResponse struct {
	Package *BenefitPackage `json:"Package"`
}

func NewCreateCustomBenefitPackageResponse() *CreateCustomBenefitPackageResponse {
	return &CreateCustomBenefitPackageResponse{}
}

func (p *CreateCustomBenefitPackageResponse) InitDefault() {
}

var CreateCustomBenefitPackageResponse_Package_DEFAULT *BenefitPackage

func (p *CreateCustomBenefitPackageResponse) GetPackage() (v *BenefitPackage) {
	if !p.IsSetPackage() {
		return CreateCustomBenefitPackageResponse_Package_DEFAULT
	}
	return p.Package
}

func (p *CreateCustomBenefitPackageResponse) IsSetPackage() bool {
	return p.Package != nil
}

func (p *CreateCustomBenefitPackageResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("CreateCustomBenefitPackageResponse(%+v)", *p)
}

type UpdateCustomBenefitPackageRequest struct {
	PackageID   string `json:"PackageID"`
	Name        string `json:"Name"`
	ProjectName string `json:"ProjectName"`
	// AccessKeyID 和 SecretAccessKey 省略时分别保留现有密钥。
	AccessKeyID      *string  `json:"AccessKeyID,omitempty"`
	SecretAccessKey  *string  `json:"SecretAccessKey,omitempty"`
	Enabled          bool     `json:"Enabled"`
	ModelIDs         []string `json:"ModelIDs"`
	ExpectedRevision int64    `json:"ExpectedRevision"`
}

func NewUpdateCustomBenefitPackageRequest() *UpdateCustomBenefitPackageRequest {
	return &UpdateCustomBenefitPackageRequest{}
}

func (p *UpdateCustomBenefitPackageRequest) InitDefault() {
}

func (p *UpdateCustomBenefitPackageRequest) GetPackageID() (v string) {
	return p.PackageID
}

func (p *UpdateCustomBenefitPackageRequest) GetName() (v string) {
	return p.Name
}

func (p *UpdateCustomBenefitPackageRequest) GetProjectName() (v string) {
	return p.ProjectName
}

var UpdateCustomBenefitPackageRequest_AccessKeyID_DEFAULT string

func (p *UpdateCustomBenefitPackageRequest) GetAccessKeyID() (v string) {
	if !p.IsSetAccessKeyID() {
		return UpdateCustomBenefitPackageRequest_AccessKeyID_DEFAULT
	}
	return *p.AccessKeyID
}

var UpdateCustomBenefitPackageRequest_SecretAccessKey_DEFAULT string

func (p *UpdateCustomBenefitPackageRequest) GetSecretAccessKey() (v string) {
	if !p.IsSetSecretAccessKey() {
		return UpdateCustomBenefitPackageRequest_SecretAccessKey_DEFAULT
	}
	return *p.SecretAccessKey
}

func (p *UpdateCustomBenefitPackageRequest) GetEnabled() (v bool) {
	return p.Enabled
}

func (p *UpdateCustomBenefitPackageRequest) GetModelIDs() (v []string) {
	return p.ModelIDs
}

func (p *UpdateCustomBenefitPackageRequest) GetExpectedRevision() (v int64) {
	return p.ExpectedRevision
}

func (p *UpdateCustomBenefitPackageRequest) IsSetAccessKeyID() bool {
	return p.AccessKeyID != nil
}

func (p *UpdateCustomBenefitPackageRequest) IsSetSecretAccessKey() bool {
	return p.SecretAccessKey != nil
}

func (p *UpdateCustomBenefitPackageRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("UpdateCustomBenefitPackageRequest(%+v)", *p)
}

type UpdateCustomBenefitPackageResponse struct {
	Package *BenefitPackage `json:"Package"`
}

func NewUpdateCustomBenefitPackageResponse() *UpdateCustomBenefitPackageResponse {
	return &UpdateCustomBenefitPackageResponse{}
}

func (p *UpdateCustomBenefitPackageResponse) InitDefault() {
}

var UpdateCustomBenefitPackageResponse_Package_DEFAULT *BenefitPackage

func (p *UpdateCustomBenefitPackageResponse) GetPackage() (v *BenefitPackage) {
	if !p.IsSetPackage() {
		return UpdateCustomBenefitPackageResponse_Package_DEFAULT
	}
	return p.Package
}

func (p *UpdateCustomBenefitPackageResponse) IsSetPackage() bool {
	return p.Package != nil
}

func (p *UpdateCustomBenefitPackageResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("UpdateCustomBenefitPackageResponse(%+v)", *p)
}

type DeleteCustomBenefitPackageRequest struct {
	PackageID        string `json:"PackageID"`
	ExpectedRevision int64  `json:"ExpectedRevision"`
	// 省略或 false 仅使本地审核结果失效；true 还会清理外部 provider 已审核素材。
	DeleteExternalReviewedAssets *bool `json:"DeleteExternalReviewedAssets,omitempty"`
}

func NewDeleteCustomBenefitPackageRequest() *DeleteCustomBenefitPackageRequest {
	return &DeleteCustomBenefitPackageRequest{}
}

func (p *DeleteCustomBenefitPackageRequest) InitDefault() {
}

func (p *DeleteCustomBenefitPackageRequest) GetPackageID() (v string) {
	return p.PackageID
}

func (p *DeleteCustomBenefitPackageRequest) GetExpectedRevision() (v int64) {
	return p.ExpectedRevision
}

var DeleteCustomBenefitPackageRequest_DeleteExternalReviewedAssets_DEFAULT bool

func (p *DeleteCustomBenefitPackageRequest) GetDeleteExternalReviewedAssets() (v bool) {
	if !p.IsSetDeleteExternalReviewedAssets() {
		return DeleteCustomBenefitPackageRequest_DeleteExternalReviewedAssets_DEFAULT
	}
	return *p.DeleteExternalReviewedAssets
}

func (p *DeleteCustomBenefitPackageRequest) IsSetDeleteExternalReviewedAssets() bool {
	return p.DeleteExternalReviewedAssets != nil
}

func (p *DeleteCustomBenefitPackageRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("DeleteCustomBenefitPackageRequest(%+v)", *p)
}
