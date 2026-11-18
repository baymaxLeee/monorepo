package persistenceid

// ParseValidStrings returns canonical IDs suitable for PostgreSQL array parameters.
func ParseValidStrings(values []string) []string {
	ids := make([]string, 0, len(values))
	for _, value := range values {
		if id, err := Parse(value); err == nil {
			ids = append(ids, id.String())
		}
	}
	return ids
}

// OptionalText converts an optional, validated ID to its SQL representation.
func OptionalText(id *UUID) *string {
	if id == nil {
		return nil
	}
	value := id.String()
	return &value
}
