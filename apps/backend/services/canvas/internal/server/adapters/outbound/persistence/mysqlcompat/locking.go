package mysqlcompat

import "gorm.io/gorm/clause"

// ForUpdate returns the strongest portable claim lock for the configured
// MySQL compatibility level. MySQL 5.7 does not support SKIP LOCKED.
func ForUpdate(compatibleVersion int) clause.Locking {
	locking := clause.Locking{Strength: "UPDATE"}
	if compatibleVersion == 8 {
		locking.Options = "SKIP LOCKED"
	}
	return locking
}
