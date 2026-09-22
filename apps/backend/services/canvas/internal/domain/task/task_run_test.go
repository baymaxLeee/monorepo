package task

import (
	"errors"
	"testing"
	"time"
)

func TestStoryboardTaskRunTargetsDraftNode(t *testing.T) {
	t.Parallel()

	now := time.Now()
	run := TaskRun{
		ID: "run-1", TenantID: "tenant-1", CreatedBy: "user-1",
		RunType: RunTypeCanvasStoryboardGeneration, SubjectType: SubjectTypeCanvasNode,
		SubjectID: "draft-node-1", Status: StatusQueued, StateVersion: 1,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := run.Validate(); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}

	run.SubjectType = SubjectTypeCanvas
	if err := run.Validate(); !errors.Is(err, ErrInvalidTaskRun) {
		t.Fatalf("Validate() error = %v, want ErrInvalidTaskRun", err)
	}
}
