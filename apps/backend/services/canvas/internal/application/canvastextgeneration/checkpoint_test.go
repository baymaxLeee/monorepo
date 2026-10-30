package canvastextgeneration

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestCheckpointFlushesUTF8TailWhenProviderStalls(t *testing.T) {
	type write struct {
		offset int64
		delta  string
	}
	written := make(chan write, 10)
	writer := newCheckpointWriter(context.Background(), func(_ context.Context, offset int64, delta string) error { written <- write{offset, delta}; return nil }, 0)
	defer writer.close()
	if err := writer.append("你好"); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-written:
		if got.offset != 0 || got.delta != "你好" {
			t.Fatal(got)
		}
	case <-time.After(time.Second):
		t.Fatal("stalled provider tail was not checkpointed")
	}
	if err := writer.append("世界"); err != nil {
		t.Fatal(err)
	}
	if err := writer.close(); err != nil {
		t.Fatal(err)
	}
	got := <-written
	if got.offset != 6 || got.delta != "世界" {
		t.Fatal(got)
	}
	if err := writer.close(); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-written:
		t.Fatalf("duplicate final checkpoint: %+v", got)
	default:
	}
}
func TestCheckpointRejectsPersistenceFailureAndInvalidUTF8(t *testing.T) {
	failed := errors.New("database transaction failed")
	calls := 0
	writer := newCheckpointWriter(context.Background(), func(context.Context, int64, string) error { calls++; return failed }, 0)
	if err := writer.append(string([]byte{0xff})); err == nil {
		t.Fatal("accepted invalid UTF-8")
	}
	if err := writer.append(strings.Repeat("a", 1024)); !errors.Is(err, failed) {
		t.Fatal(err)
	}
	if err := writer.append("tail"); !errors.Is(err, failed) {
		t.Fatal(err)
	}
	if err := writer.close(); !errors.Is(err, failed) || calls != 1 {
		t.Fatalf("failure replayed: %d %v", calls, err)
	}
}
