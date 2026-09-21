package canvasarchive

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"time"
)

const DefaultMultipartPartSize int64 = 64 << 20

type MultipartCreateResult struct {
	UploadID, Path string
	Exist          bool
}

type MultipartClient interface {
	Create(context.Context, string, string) (MultipartCreateResult, error)
	CheckPart(context.Context, string, int32, string) (bool, error)
	UploadPart(context.Context, string, int32, string, io.Reader, int64) error
	Complete(context.Context, string, []string) (string, error)
	Abort(context.Context, string) error
	LongLive(context.Context, string, string) error
}

type UploadFile struct {
	Path, Filename, SHA256 string
	Size                   int64
}

type UploadResult struct {
	Path, UploadID string
	PartSize       int64
}

type MultipartUploader struct {
	client   MultipartClient
	partSize int64
}

func NewMultipartUploader(client MultipartClient, partSize int64) *MultipartUploader {
	if partSize <= 0 {
		partSize = DefaultMultipartPartSize
	}
	return &MultipartUploader{client: client, partSize: partSize}
}

func (u *MultipartUploader) Upload(ctx context.Context, input UploadFile) (result UploadResult, err error) {
	file, err := os.Open(input.Path)
	if err != nil {
		return UploadResult{}, err
	}
	defer func() {
		err = errors.Join(err, file.Close())
	}()
	info, err := file.Stat()
	if err != nil {
		return UploadResult{}, err
	}
	if input.Size != info.Size() || input.Size < 0 {
		return UploadResult{}, fmt.Errorf("archive size changed: got %d, want %d", info.Size(), input.Size)
	}
	created, err := u.client.Create(ctx, input.SHA256, input.Filename)
	if err != nil {
		return UploadResult{}, err
	}
	if created.Exist {
		if created.Path == "" {
			return UploadResult{}, errors.New("multipart create returned empty existing path")
		}
		return UploadResult{Path: created.Path, PartSize: u.partSize}, nil
	}
	if created.UploadID == "" {
		return UploadResult{}, errors.New("multipart create returned empty upload id")
	}
	chunks := make([]string, 0, (input.Size+u.partSize-1)/u.partSize)
	for offset, partID := int64(0), int32(1); offset < input.Size; offset, partID = offset+u.partSize, partID+1 {
		length := min(u.partSize, input.Size-offset)
		partSHA, hashErr := sectionSHA256(file, offset, length)
		if hashErr != nil {
			return UploadResult{}, errors.Join(hashErr, u.abort(ctx, created.UploadID))
		}
		exists, checkErr := u.client.CheckPart(ctx, created.UploadID, partID, partSHA)
		if checkErr != nil {
			return UploadResult{}, errors.Join(checkErr, u.abort(ctx, created.UploadID))
		}
		if !exists {
			section := io.NewSectionReader(file, offset, length)
			if uploadErr := u.client.UploadPart(ctx, created.UploadID, partID, partSHA, section, length); uploadErr != nil {
				return UploadResult{}, errors.Join(uploadErr, u.abort(ctx, created.UploadID))
			}
		}
		chunks = append(chunks, partSHA)
	}
	path, err := u.client.Complete(ctx, created.UploadID, chunks)
	if err != nil {
		recovered, recoveryErr := u.client.Create(ctx, input.SHA256, input.Filename)
		if recoveryErr == nil && recovered.Exist && recovered.Path != "" {
			path = recovered.Path
		} else {
			var recoveryAbortErr error
			if recoveryErr == nil && !recovered.Exist && recovered.UploadID != "" {
				recoveryAbortErr = u.abort(ctx, recovered.UploadID)
			}
			return UploadResult{}, errors.Join(err, recoveryErr, recoveryAbortErr, u.abort(ctx, created.UploadID))
		}
	}
	if path == "" {
		return UploadResult{}, errors.New("multipart complete returned empty path")
	}
	return UploadResult{Path: path, UploadID: created.UploadID, PartSize: u.partSize}, nil
}

func (u *MultipartUploader) abort(ctx context.Context, uploadID string) error {
	abortCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer cancel()
	return u.client.Abort(abortCtx, uploadID)
}

func sectionSHA256(file *os.File, offset, length int64) (string, error) {
	hash := sha256.New()
	if _, err := io.Copy(hash, io.NewSectionReader(file, offset, length)); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}
