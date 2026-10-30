package conversion

import (
	"context"
	"database/sql"
	"embed"
	"encoding/json"
	"fmt"
)

//go:embed *.go
var Source embed.FS

func Up(ctx context.Context, tx *sql.Tx) error { return convert(ctx, tx, "name", "displayName") }
func convert(ctx context.Context, tx *sql.Tx, from, to string) error {
	rows, err := tx.QueryContext(ctx, "SELECT value FROM public.keep_data ORDER BY value")
	if err != nil {
		return err
	}
	var values []string
	for rows.Next() {
		var value string
		if err = rows.Scan(&value); err != nil {
			rows.Close()
			return err
		}
		values = append(values, value)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, value := range values {
		var object map[string]any
		if err = json.Unmarshal([]byte(value), &object); err != nil {
			return err
		}
		field, ok := object[from]
		if !ok {
			return fmt.Errorf("missing %s", from)
		}
		if _, ok = object[to]; ok {
			return fmt.Errorf("destination exists: %s", to)
		}
		object[to] = field
		delete(object, from)
		encoded, err := json.Marshal(object)
		if err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, "UPDATE public.keep_data SET value=$1 WHERE value=$2", string(encoded), value); err != nil {
			return err
		}
	}
	return nil
}
