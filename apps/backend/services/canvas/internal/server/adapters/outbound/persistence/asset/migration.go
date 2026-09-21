package asset

import (
	"errors"

	"gorm.io/gorm"
)

const legacyArtifactUniqueIndex = "uniq_assets_artifact"

// PrepareMigration removes the legacy one-to-one Artifact constraint before
// AutoMigrate creates the current non-unique lookup index.
func PrepareMigration(db *gorm.DB) error {
	if db == nil {
		return errors.New("asset migration requires a database")
	}
	if !db.Migrator().HasIndex(&assetRow{}, legacyArtifactUniqueIndex) {
		return nil
	}
	return db.Migrator().DropIndex(&assetRow{}, legacyArtifactUniqueIndex)
}
