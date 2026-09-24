package storage

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/example/monorepo/asset/internal/application"
)

func TestFilesystemStage(t *testing.T) {
	store, err := NewFilesystem(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}

	t.Run("streams content and detects its type", func(t *testing.T) {
		payload := append([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}, bytes.Repeat([]byte{0}, 1024*1024)...)
		staged, stageErr := store.Stage(context.Background(), "image", bytes.NewReader(payload), int64(len(payload)))
		if stageErr != nil {
			t.Fatal(stageErr)
		}
		if staged.SizeBytes != int64(len(payload)) {
			t.Fatalf("size = %d, want %d", staged.SizeBytes, len(payload))
		}
		if staged.DetectedMediaType != "image/png" {
			t.Fatalf("media type = %q, want image/png", staged.DetectedMediaType)
		}
	})

	t.Run("rejects oversized input and removes staging file", func(t *testing.T) {
		_, stageErr := store.Stage(context.Background(), "oversized", strings.NewReader("12345"), 4)
		if !errors.Is(stageErr, ErrUploadTooLarge) {
			t.Fatalf("error = %v, want ErrUploadTooLarge", stageErr)
		}
		if _, statErr := os.Stat(filepath.Join(store.staging, "oversized.part")); !errors.Is(statErr, os.ErrNotExist) {
			t.Fatalf("staging file remains: %v", statErr)
		}
	})

	t.Run("honors cancelled context", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		_, stageErr := store.Stage(ctx, "cancelled", strings.NewReader("payload"), 100)
		if !errors.Is(stageErr, context.Canceled) {
			t.Fatalf("error = %v, want context.Canceled", stageErr)
		}
	})
}

func TestFilesystemCommit(t *testing.T) {
	store, err := NewFilesystem(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	staged, err := store.Stage(context.Background(), "commit", strings.NewReader("durable payload"), 100)
	if err != nil {
		t.Fatal(err)
	}
	const key = "blobs/tenant/aa/bb/blob-id"
	if err = store.Commit(context.Background(), staged, key); err != nil {
		t.Fatal(err)
	}

	t.Run("opens committed bytes", func(t *testing.T) {
		reader, openErr := store.Open(context.Background(), key)
		if openErr != nil {
			t.Fatal(openErr)
		}
		defer reader.Body.Close()
		got, readErr := io.ReadAll(reader.Body)
		if readErr != nil {
			t.Fatal(readErr)
		}
		if string(got) != "durable payload" {
			t.Fatalf("content = %q", got)
		}
	})

	t.Run("retry after successful rename is idempotent", func(t *testing.T) {
		if retryErr := store.Commit(context.Background(), staged, key); retryErr != nil {
			t.Fatalf("retry error = %v, want nil", retryErr)
		}
	})
}

func TestFilesystemDelete(t *testing.T) {
	store, err := NewFilesystem(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	staged, err := store.Stage(context.Background(), "delete", strings.NewReader("payload"), 100)
	if err != nil {
		t.Fatal(err)
	}
	const key = "blobs/a/b/c"
	if err = store.Commit(context.Background(), staged, key); err != nil {
		t.Fatal(err)
	}
	if err = store.Delete(context.Background(), key); err != nil {
		t.Fatal(err)
	}
	if err = store.Delete(context.Background(), key); err != nil {
		t.Fatalf("second delete = %v, want nil", err)
	}
	if _, err = store.Open(context.Background(), key); !errors.Is(err, application.ErrNotFound) {
		t.Fatalf("open error = %v, want ErrNotFound", err)
	}
}

func TestFilesystemCleanupUpload(t *testing.T) {
	store, err := NewFilesystem(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Stage(context.Background(), "abandoned", strings.NewReader("payload"), 100); err != nil {
		t.Fatal(err)
	}
	if err = store.CleanupUpload(context.Background(), "abandoned"); err != nil {
		t.Fatal(err)
	}
	if err = store.CleanupUpload(context.Background(), "abandoned"); err != nil {
		t.Fatalf("idempotent cleanup = %v, want nil", err)
	}
	if _, err = os.Stat(filepath.Join(store.staging, "abandoned.part")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("staging file remains: %v", err)
	}
	if err = store.CleanupUpload(context.Background(), "../outside"); !errors.Is(err, application.ErrInvalidInput) {
		t.Fatalf("unsafe upload ID error = %v, want ErrInvalidInput", err)
	}
}

func TestFilesystemResolve(t *testing.T) {
	store, err := NewFilesystem(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"", ".", "..", "../outside", "/absolute"} {
		t.Run(key, func(t *testing.T) {
			if _, resolveErr := store.resolve(key); !errors.Is(resolveErr, application.ErrInvalidInput) {
				t.Fatalf("resolve(%q) = %v, want ErrInvalidInput", key, resolveErr)
			}
		})
	}
}
