package benefitpackage

import (
	"errors"
	"strings"
	"time"
)

const (
	MaxNameLength        = 80
	MaxProjectNameLength = 128
	MaxModelCount        = 100
	PresetName           = "预置权益包"
	PresetProjectName    = "default"
)

type ScopeType string

const (
	ScopeCustomModels       ScopeType = "CUSTOM_MODELS"
	ScopeSystemPresetModels ScopeType = "SYSTEM_PRESET_MODELS"
)

var ErrInvalid = errors.New("invalid benefit package")

type Package struct {
	ID                       string
	TenantID                 string
	IsPreset                 bool
	Name                     string
	ProjectName              string
	AssetGroupID             string
	EncryptedAccessKeyID     string
	EncryptedSecretAccessKey string
	Enabled                  bool
	ScopeType                ScopeType
	ModelIDs                 []string
	MaterialUsed             int64
	Revision                 int64
	CreatedBy                string
	UpdatedBy                string
	CreatedAt                time.Time
	UpdatedAt                time.Time
	DeletedAt                *time.Time
}

type NewInput struct {
	ID, TenantID, Name, ProjectName, AssetGroupID, EncryptedAccessKeyID, EncryptedSecretAccessKey, CreatedBy string
	IsPreset, Enabled                                                                                        bool
	ScopeType                                                                                                ScopeType
	ModelIDs                                                                                                 []string
	Now                                                                                                      time.Time
}

func New(input NewInput) (Package, error) {
	item := Package{
		ID: input.ID, TenantID: input.TenantID, IsPreset: input.IsPreset,
		Name: strings.TrimSpace(input.Name), ProjectName: strings.TrimSpace(input.ProjectName),
		AssetGroupID:         strings.TrimSpace(input.AssetGroupID),
		EncryptedAccessKeyID: input.EncryptedAccessKeyID, EncryptedSecretAccessKey: input.EncryptedSecretAccessKey,
		Enabled: input.Enabled, ScopeType: input.ScopeType, ModelIDs: normalizeModels(input.ModelIDs), Revision: 1,
		CreatedBy: input.CreatedBy, UpdatedBy: input.CreatedBy, CreatedAt: input.Now.UTC(), UpdatedAt: input.Now.UTC(),
	}
	if !item.valid() {
		return Package{}, ErrInvalid
	}
	return item, nil
}

func (item *Package) Update(name, projectName, encryptedAccessKeyID, encryptedSecret string, enabled bool, scopeType ScopeType, modelIDs []string, updatedBy string, now time.Time) error {
	item.Name = strings.TrimSpace(name)
	item.ProjectName = strings.TrimSpace(projectName)
	if encryptedAccessKeyID != "" {
		item.EncryptedAccessKeyID = encryptedAccessKeyID
	}
	if encryptedSecret != "" {
		item.EncryptedSecretAccessKey = encryptedSecret
	}
	item.Enabled = enabled
	item.ScopeType = scopeType
	item.ModelIDs = normalizeModels(modelIDs)
	item.UpdatedBy = updatedBy
	item.UpdatedAt = now.UTC()
	item.Revision++
	if !item.valid() {
		return ErrInvalid
	}
	return nil
}

func (item *Package) Delete(updatedBy string, now time.Time) {
	deletedAt := now.UTC()
	item.UpdatedBy = updatedBy
	item.UpdatedAt = deletedAt
	item.DeletedAt = &deletedAt
	item.Revision++
}

func (item Package) valid() bool {
	modelsValid := item.ScopeType == ScopeSystemPresetModels && item.IsPreset && len(item.ModelIDs) == 0 ||
		item.ScopeType == ScopeCustomModels && !item.IsPreset && len(item.ModelIDs) >= 1 && len(item.ModelIDs) <= MaxModelCount
	presetFieldsValid := !item.IsPreset || item.Name == PresetName && item.ProjectName == PresetProjectName
	return item.ID != "" && item.TenantID != "" && item.CreatedBy != "" && item.UpdatedBy != "" &&
		item.Name != "" && len([]rune(item.Name)) <= MaxNameLength && item.ProjectName != "" &&
		len(item.ProjectName) <= MaxProjectNameLength && item.AssetGroupID != "" && item.EncryptedAccessKeyID != "" &&
		item.EncryptedSecretAccessKey != "" && modelsValid && presetFieldsValid &&
		item.Revision > 0 && !item.CreatedAt.IsZero() && !item.UpdatedAt.IsZero()
}

func normalizeModels(input []string) []string {
	seen := make(map[string]struct{}, len(input))
	result := make([]string, 0, len(input))
	for _, value := range input {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}
