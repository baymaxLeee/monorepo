package task

import "time"

// PollSchedule contains only reusable provider polling coordination state.
// Target-specific provider facts belong to the corresponding target detail.
type PollSchedule struct {
	TaskRunID                        string
	NextPollAt                       time.Time
	LeaseUntil                       *time.Time
	StateVersion                     int64
	PollAttempts, ConsecutiveErrors  int32
	DeadlineAt, CreatedAt, UpdatedAt time.Time
}

type PollScheduleUpdate struct {
	NextPollAt                      time.Time
	PollAttempts, ConsecutiveErrors int32
	DeadlineAt                      *time.Time
}
