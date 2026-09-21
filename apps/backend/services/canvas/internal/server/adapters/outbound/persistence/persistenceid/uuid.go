package persistenceid

import (
	"database/sql/driver"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

// Canvas APIs use compact UUID strings; PostgreSQL persists native UUID values.
type UUID uuid.UUID

func Parse(value string) (UUID, error) {
	parsed, err := uuid.Parse(value)
	if err != nil {
		return UUID{}, fmt.Errorf("parse UUID: %w", err)
	}
	return fromUUID(parsed)
}

func ParseOptional(value string) (*UUID, error) {
	if value == "" {
		return nil, nil
	}
	parsed, err := Parse(value)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}

// ParseValid converts valid AgentFrame-generated identifiers and omits malformed values.
func ParseValid(values []string) []UUID {
	parsed := make([]UUID, 0, len(values))
	for _, value := range values {
		id, err := Parse(value)
		if err == nil {
			parsed = append(parsed, id)
		}
	}
	return parsed
}

func (id UUID) String() string {
	return strings.ReplaceAll(uuid.UUID(id).String(), "-", "")
}

func (id UUID) Value() (driver.Value, error) {
	parsed, err := fromUUID(uuid.UUID(id))
	if err != nil {
		return nil, err
	}
	return parsed.String(), nil
}

func (id *UUID) Scan(value any) error {
	if id == nil {
		return fmt.Errorf("scan UUID into nil receiver")
	}
	var (
		parsed uuid.UUID
		err    error
	)
	switch value := value.(type) {
	case []byte:
		parsed, err = uuid.ParseBytes(value)
	case string:
		parsed, err = uuid.Parse(value)
	default:
		return fmt.Errorf("scan UUID from %T", value)
	}
	if err != nil {
		return fmt.Errorf("scan UUID: %w", err)
	}
	converted, err := fromUUID(parsed)
	if err != nil {
		return err
	}
	*id = converted
	return nil
}

func (UUID) GormDataType() string { return "uuid" }

func (UUID) GormDBDataType(db *gorm.DB, _ *schema.Field) string {
	if db == nil || db.Dialector == nil {
		return ""
	}
	switch db.Name() {
	case "mysql":
		return "char(36)"
	case "sqlite":
		return "text"
	default:
		return ""
	}
}

func fromUUID(parsed uuid.UUID) (UUID, error) {
	if parsed == uuid.Nil {
		return UUID{}, fmt.Errorf("UUID must not be empty")
	}
	return UUID(parsed), nil
}
