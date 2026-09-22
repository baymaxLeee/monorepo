package canvasarchive

import (
	"errors"

	"gorm.io/gorm"
)

// PrepareMigration drops the obsolete per-input schema before AutoMigrate.
// The repository is still in its destructive-schema development phase, so
// preserving those snapshots would add a temporary dual-read contract.
func PrepareMigration(db *gorm.DB) error {
	if db == nil {
		return errors.New("canvas archive migration requires a database")
	}
	const table = "canvas_video_archive_export_inputs"
	if !db.Migrator().HasTable(table) || !db.Migrator().HasColumn(table, "ordinal") {
		return nil
	}
	return db.Migrator().DropTable(table)
}
