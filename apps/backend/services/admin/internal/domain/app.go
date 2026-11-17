package domain

import "time"

type App struct {
	ID, Title, BasePath, RemoteName, ExposeKey, Entry string
	RequiresAdmin, IsEnabled                          bool
	SortOrder                                         int
	CreatedAt, UpdatedAt                              time.Time
}
