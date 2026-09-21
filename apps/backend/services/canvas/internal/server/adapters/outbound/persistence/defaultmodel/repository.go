package defaultmodel

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	applicationmodel "github.com/example/monorepo/canvas/internal/server/application/model"
)

type Repository struct{ db *gorm.DB }

func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

func (r *Repository) GetAll(ctx context.Context, tenantID string) (applicationmodel.DefaultModels, error) {
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" {
		return applicationmodel.DefaultModels{}, errors.New("tenant ID must not be empty")
	}
	var row defaultModelRow
	if err := r.db.WithContext(ctx).Where("tenant_id = ?", tenantID).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return applicationmodel.DefaultModels{}, nil
		}
		return applicationmodel.DefaultModels{}, fmt.Errorf("get default model config: %w", err)
	}
	var config applicationmodel.DefaultModels
	if err := json.Unmarshal(row.Config, &config); err != nil {
		return applicationmodel.DefaultModels{}, fmt.Errorf("decode default model config: %w", err)
	}
	return config, nil
}

func (r *Repository) Get(
	ctx context.Context,
	tenantID string,
	capability applicationmodel.Capability,
) (applicationmodel.Selection, error) {
	config, err := r.GetAll(ctx, tenantID)
	if err != nil {
		return applicationmodel.Selection{}, err
	}
	switch capability {
	case applicationmodel.CapabilityStoryboardInference, applicationmodel.CapabilityCanvasTextGeneration:
		return config.InferenceModel, nil
	case applicationmodel.CapabilityResourceTextToImage, applicationmodel.CapabilityResourceImageToImage:
		return config.ImageModel, nil
	case applicationmodel.CapabilityCanvasNodeVideo:
		return config.VideoModel, nil
	default:
		return applicationmodel.Selection{}, fmt.Errorf("unsupported model capability %q", capability)
	}
}

func (r *Repository) Save(
	ctx context.Context,
	tenantID, userID string,
	config applicationmodel.DefaultModels,
) error {
	tenantID, userID = strings.TrimSpace(tenantID), strings.TrimSpace(userID)
	if tenantID == "" || userID == "" {
		return errors.New("tenant ID and user ID must not be empty")
	}
	encoded, err := json.Marshal(config)
	if err != nil {
		return fmt.Errorf("encode default model config: %w", err)
	}
	now := time.Now().UTC()
	row := defaultModelRow{
		TenantID: tenantID, Config: encoded, Revision: 1,
		CreatedBy: userID, UpdatedBy: userID, CreatedAt: now, UpdatedAt: now,
	}
	err = r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "tenant_id"}},
		DoUpdates: clause.Assignments(map[string]any{
			"config": encoded, "revision": gorm.Expr("default_model_configs.revision + 1"),
			"imported_from_iam": false, "updated_by": userID, "updated_at": now,
		}),
	}).Create(&row).Error
	if err != nil {
		return fmt.Errorf("save default model config: %w", err)
	}
	return nil
}

func (r *Repository) DeleteByTenant(ctx context.Context, tenantID, _ string) error {
	result := r.db.WithContext(ctx).Where("tenant_id = ?", strings.TrimSpace(tenantID)).Delete(&defaultModelRow{})
	if result.Error != nil {
		return fmt.Errorf("delete tenant default model config: %w", result.Error)
	}
	return nil
}

var _ applicationmodel.DefaultStore = (*Repository)(nil)
