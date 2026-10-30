package dbmigrate

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

// Main is shared by the SQL binary and service binaries with registered Go migrations.
func Main(registry map[string]GoMigration) {
	if err := mainRun(registry); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func mainRun(registry map[string]GoMigration) error {
	if len(os.Args) == 3 {
		switch os.Args[1] {
		case "checksums-write":
			return WriteChecksums(os.Args[2])
		case "checksums-check":
			return CheckChecksums(os.Args[2])
		}
	}
	if len(os.Args) != 5 {
		return fmt.Errorf("usage: db-migrate <validate|run> <migrations-dir> <target-or-empty> <up|down>")
	}
	action, root, target, direction := os.Args[1], os.Args[2], os.Args[3], os.Args[4]
	if action != "validate" && action != "run" {
		return fmt.Errorf("unknown action: %s", action)
	}
	if err := Validate(root, target, direction, registry); err != nil {
		return err
	}
	if action == "validate" {
		return nil
	}
	config, err := pgx.ParseConfig("")
	if err != nil {
		return err
	}
	config.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	var db *sql.DB = stdlib.OpenDB(*config)
	defer db.Close()
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if err = Run(ctx, db, root, target, direction, registry); err != nil {
		return err
	}
	fmt.Println("Migration complete; checksums verified")
	return nil
}
