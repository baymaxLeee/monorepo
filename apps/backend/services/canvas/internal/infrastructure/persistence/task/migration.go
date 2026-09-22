package task

import (
	"errors"
	"fmt"

	"gorm.io/gorm"
)

// PrepareMigration splits the legacy shared phase/version columns before
// AutoMigrate creates the current indexes and constraints.
func PrepareMigration(db *gorm.DB) error {
	if db == nil {
		return errors.New("async dispatch migration requires a database")
	}
	const table = "async_dispatches"
	if !db.Migrator().HasTable(table) || !db.Migrator().HasColumn(table, "phase") {
		return nil
	}
	columns := []struct {
		name       string
		mysqlType  string
		sqliteType string
	}{
		{name: "delivery_state", mysqlType: "varchar(32) NULL", sqliteType: "text"},
		{name: "execution_state", mysqlType: "varchar(32) NULL", sqliteType: "text"},
		{name: "delivery_version", mysqlType: "bigint NULL", sqliteType: "integer"},
		{name: "execution_version", mysqlType: "bigint NULL", sqliteType: "integer"},
	}
	for _, column := range columns {
		if db.Migrator().HasColumn(table, column.name) {
			continue
		}
		columnType := column.sqliteType
		if db.Name() == "mysql" {
			columnType = column.mysqlType
		}
		if err := db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, column.name, columnType)).Error; err != nil {
			return fmt.Errorf("add async dispatch %s: %w", column.name, err)
		}
	}
	if err := db.Exec(`
		UPDATE async_dispatches
		   SET delivery_state = CASE
		           WHEN phase IN ('PENDING', 'RETRY_WAIT') THEN 'PENDING'
		           ELSE 'DELIVERED'
		       END,
		       execution_state = CASE
		           WHEN phase IN ('EXECUTING', 'PROVIDER_REQUESTING') THEN 'EXECUTING'
		           WHEN phase = 'FAILURE_PENDING' THEN 'FAILURE_PENDING'
		           ELSE 'WAITING'
		       END,
		       delivery_version = state_version,
		       execution_version = state_version
	`).Error; err != nil {
		return fmt.Errorf("backfill async dispatch state machines: %w", err)
	}
	if db.Migrator().HasIndex(table, "idx_async_dispatches_due") {
		if err := db.Migrator().DropIndex(table, "idx_async_dispatches_due"); err != nil {
			return fmt.Errorf("drop legacy async dispatch due index: %w", err)
		}
	}
	for _, column := range []string{"phase", "state_version"} {
		if err := db.Exec(fmt.Sprintf("ALTER TABLE %s DROP COLUMN %s", table, column)).Error; err != nil {
			return fmt.Errorf("drop legacy async dispatch %s: %w", column, err)
		}
	}
	return nil
}
