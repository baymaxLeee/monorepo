package videogeneration

import (
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type Repository struct{ store *persistencetransaction.Store }

func NewRepository(store *persistencetransaction.Store) *Repository { return &Repository{store: store} }
func parseHistoryScopeIDs(projectID, canvasID, canvasnodeID string) (
	persistenceid.UUID,
	persistenceid.UUID,
	persistenceid.UUID,
	error,
) {
	project, err := persistenceid.Parse(projectID)
	if err != nil {
		return persistenceid.UUID{}, persistenceid.UUID{}, persistenceid.UUID{}, err
	}
	canvas, err := persistenceid.Parse(canvasID)
	if err != nil {
		return persistenceid.UUID{}, persistenceid.UUID{}, persistenceid.UUID{}, err
	}
	canvasnode, err := persistenceid.Parse(canvasnodeID)
	if err != nil {
		return persistenceid.UUID{}, persistenceid.UUID{}, persistenceid.UUID{}, err
	}
	return project, canvas, canvasnode, nil
}

func nullableString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
