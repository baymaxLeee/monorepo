package storage

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/example/monorepo/asset/internal/application"
)

var ErrUploadTooLarge = errors.New("asset upload exceeds size limit")

type Filesystem struct {
	root, staging string
}

func NewFilesystem(root string) (*Filesystem, error) {
	resolved, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	store := &Filesystem{root: resolved, staging: filepath.Join(resolved, "staging")}
	if err = os.MkdirAll(store.staging, 0o750); err != nil {
		return nil, fmt.Errorf("create asset staging directory: %w", err)
	}
	return store, nil
}

func (s *Filesystem) Stage(ctx context.Context, uploadID string, source io.Reader, limit int64) (application.StagedBlob, error) {
	if uploadID == "" || limit < 1 {
		return application.StagedBlob{}, application.ErrInvalidInput
	}
	path := filepath.Join(s.staging, uploadID+".part")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o640)
	if err != nil {
		return application.StagedBlob{}, err
	}
	committed := false
	defer func() {
		_ = file.Close()
		if !committed {
			_ = os.Remove(path)
		}
	}()

	reader := bufio.NewReaderSize(source, 64*1024)
	prefix, peekErr := reader.Peek(512)
	if peekErr != nil && !errors.Is(peekErr, io.EOF) && !errors.Is(peekErr, bufio.ErrBufferFull) {
		return application.StagedBlob{}, peekErr
	}
	hash := sha256.New()
	limited := &io.LimitedReader{R: reader, N: limit + 1}
	buffer := make([]byte, 256*1024)
	written, copyErr := copyContext(ctx, io.MultiWriter(file, hash), limited, buffer)
	if copyErr != nil {
		return application.StagedBlob{}, copyErr
	}
	if written > limit {
		return application.StagedBlob{}, ErrUploadTooLarge
	}
	if err = file.Sync(); err != nil {
		return application.StagedBlob{}, err
	}
	if err = file.Close(); err != nil {
		return application.StagedBlob{}, err
	}
	committed = true
	return application.StagedBlob{
		UploadID: uploadID, TemporaryKey: "staging/" + uploadID + ".part",
		SHA256: hex.EncodeToString(hash.Sum(nil)), SizeBytes: written,
		DetectedMediaType: http.DetectContentType(prefix),
	}, nil
}

func copyContext(ctx context.Context, dst io.Writer, src io.Reader, buffer []byte) (int64, error) {
	var written int64
	for {
		if err := ctx.Err(); err != nil {
			return written, err
		}
		n, readErr := src.Read(buffer)
		if n > 0 {
			wn, writeErr := dst.Write(buffer[:n])
			written += int64(wn)
			if writeErr != nil {
				return written, writeErr
			}
			if wn != n {
				return written, io.ErrShortWrite
			}
		}
		if errors.Is(readErr, io.EOF) {
			return written, nil
		}
		if readErr != nil {
			return written, readErr
		}
	}
}

func (s *Filesystem) Commit(_ context.Context, staged application.StagedBlob, storageKey string) error {
	source, err := s.resolve(staged.TemporaryKey)
	if err != nil {
		return err
	}
	target, err := s.resolve(storageKey)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
		return err
	}
	if _, statErr := os.Stat(target); statErr == nil {
		if err = os.Remove(source); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return syncDirectory(filepath.Dir(source))
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return statErr
	}
	if err = os.Rename(source, target); err != nil {
		return err
	}
	if err = syncDirectory(filepath.Dir(target)); err != nil {
		return err
	}
	return syncDirectory(filepath.Dir(source))
}

func (s *Filesystem) Abort(_ context.Context, staged application.StagedBlob) error {
	path, err := s.resolve(staged.TemporaryKey)
	if err != nil {
		return err
	}
	if err = os.Remove(path); errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func (s *Filesystem) CleanupUpload(_ context.Context, uploadID string) error {
	if uploadID == "" || strings.ContainsAny(uploadID, `/\`) {
		return application.ErrInvalidInput
	}
	path, err := s.resolve("staging/" + uploadID + ".part")
	if err != nil {
		return err
	}
	if err = os.Remove(path); errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func (s *Filesystem) Open(_ context.Context, storageKey string) (application.BlobReader, error) {
	path, err := s.resolve(storageKey)
	if err != nil {
		return application.BlobReader{}, err
	}
	file, err := os.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return application.BlobReader{}, application.ErrNotFound
		}
		return application.BlobReader{}, err
	}
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return application.BlobReader{}, err
	}
	return application.BlobReader{Body: file, Size: info.Size()}, nil
}

func (s *Filesystem) Delete(_ context.Context, storageKey string) error {
	path, err := s.resolve(storageKey)
	if err != nil {
		return err
	}
	if err = os.Remove(path); errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	return syncDirectory(filepath.Dir(path))
}

func syncDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

func (s *Filesystem) Healthy(_ context.Context, minimumFreeBytes int64) error {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(s.root, &stat); err != nil {
		return err
	}
	free := int64(stat.Bavail) * int64(stat.Bsize)
	if free < minimumFreeBytes {
		return fmt.Errorf("asset storage low space: %d bytes available", free)
	}
	return nil
}

func (s *Filesystem) resolve(key string) (string, error) {
	clean := filepath.Clean(strings.TrimSpace(key))
	if clean == "." || filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", application.ErrInvalidInput
	}
	path := filepath.Join(s.root, clean)
	relative, err := filepath.Rel(s.root, path)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", application.ErrInvalidInput
	}
	return path, nil
}
