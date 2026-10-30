package conversion

import (
	"context"
	"database/sql"
)

func Down(ctx context.Context, tx *sql.Tx) error { return convert(ctx, tx, "displayName", "name") }
