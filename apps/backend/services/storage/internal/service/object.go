package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/example/monorepo/storage/internal/config"
	"github.com/example/monorepo/storage/internal/crud"
	"github.com/example/monorepo/storage/internal/model"
	"github.com/example/monorepo/storage/internal/schema"
)

var (
	ErrInvalidObject = errors.New("invalid object")
	ErrTooLarge      = errors.New("object too large")
	ErrNotFound      = crud.ErrNotFound

	safeSegmentRe = regexp.MustCompile(`^[A-Za-z0-9._=-]+$`)
)

type PutInput struct {
	Bucket             string
	Key                string
	ContentType        string
	ContentDisposition string
	Metadata           map[string]string
	OwnerUserID        string
	Body               io.Reader
}

type ObjectService struct {
	store *crud.Store
	cfg   config.Config
}

func NewObjectService(store *crud.Store, cfg config.Config) *ObjectService {
	return &ObjectService{store: store, cfg: cfg}
}

func (s *ObjectService) Put(ctx context.Context, input PutInput) (schema.ObjectResponse, error) {
	bucket := normalizeBucket(input.Bucket, s.cfg.DefaultBucketName)
	key := strings.TrimPrefix(input.Key, "/")
	if !validBucket(bucket) || !validObjectKey(key) {
		return schema.ObjectResponse{}, ErrInvalidObject
	}
	contentType := strings.TrimSpace(input.ContentType)
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	if _, _, err := mime.ParseMediaType(contentType); err != nil {
		contentType = "application/octet-stream"
	}

	tempPath, finalPath, storagePath, err := s.paths(bucket, key)
	if err != nil {
		return schema.ObjectResponse{}, err
	}
	if err := os.MkdirAll(filepath.Dir(tempPath), 0o755); err != nil {
		return schema.ObjectResponse{}, err
	}
	if err := os.MkdirAll(filepath.Dir(finalPath), 0o755); err != nil {
		return schema.ObjectResponse{}, err
	}

	tmp, err := os.OpenFile(tempPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return schema.ObjectResponse{}, err
	}
	cleanupTemp := true
	defer func() {
		_ = tmp.Close()
		if cleanupTemp {
			_ = os.Remove(tempPath)
		}
	}()

	hasher := sha256.New()
	limited := io.LimitReader(input.Body, s.cfg.MaxObjectBytes+1)
	size, err := io.Copy(tmp, io.MultiReader(io.TeeReader(limited, hasher)))
	if err != nil {
		return schema.ObjectResponse{}, err
	}
	if size > s.cfg.MaxObjectBytes {
		return schema.ObjectResponse{}, ErrTooLarge
	}
	if err := tmp.Sync(); err != nil {
		return schema.ObjectResponse{}, err
	}
	if err := tmp.Close(); err != nil {
		return schema.ObjectResponse{}, err
	}
	if err := os.Rename(tempPath, finalPath); err != nil {
		return schema.ObjectResponse{}, err
	}
	cleanupTemp = false

	now := time.Now().UTC()
	sum := hex.EncodeToString(hasher.Sum(nil))
	metadata := cleanMetadata(input.Metadata)
	metadataJSON, _ := json.Marshal(metadata)
	obj := model.Object{
		ID:                 newID(),
		Bucket:             bucket,
		ObjectKey:          key,
		Backend:            "local",
		StoragePath:        storagePath,
		ETag:               `"` + sum + `"`,
		SHA256:             sum,
		SizeBytes:          size,
		ContentType:        contentType,
		ContentDisposition: strings.TrimSpace(input.ContentDisposition),
		MetadataJSON:       string(metadataJSON),
		OwnerUserID:        strings.TrimSpace(input.OwnerUserID),
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	if err := s.store.UpsertObject(ctx, obj); err != nil {
		_ = os.Remove(finalPath)
		return schema.ObjectResponse{}, err
	}
	return responseFromModel(obj), nil
}

func (s *ObjectService) Get(ctx context.Context, bucket, key string) (model.Object, string, error) {
	bucket = normalizeBucket(bucket, s.cfg.DefaultBucketName)
	key = strings.TrimPrefix(key, "/")
	if !validBucket(bucket) || !validObjectKey(key) {
		return model.Object{}, "", ErrInvalidObject
	}
	obj, err := s.store.Object(ctx, bucket, key)
	if err != nil {
		return model.Object{}, "", err
	}
	path := filepath.Join(s.cfg.StorageDataDir, filepath.FromSlash(obj.StoragePath))
	return obj, path, nil
}

func (s *ObjectService) Head(ctx context.Context, bucket, key string) (schema.ObjectResponse, error) {
	obj, _, err := s.Get(ctx, bucket, key)
	if err != nil {
		return schema.ObjectResponse{}, err
	}
	return responseFromModel(obj), nil
}

func (s *ObjectService) Delete(ctx context.Context, bucket, key string) error {
	obj, err := s.store.DeleteObject(ctx, normalizeBucket(bucket, s.cfg.DefaultBucketName), strings.TrimPrefix(key, "/"))
	if err != nil {
		return err
	}
	path := filepath.Join(s.cfg.StorageDataDir, filepath.FromSlash(obj.StoragePath))
	_ = os.Remove(path)
	return nil
}

func responseFromModel(obj model.Object) schema.ObjectResponse {
	metadata := map[string]string{}
	_ = json.Unmarshal([]byte(obj.MetadataJSON), &metadata)
	return schema.ObjectResponse{
		Bucket:             obj.Bucket,
		Key:                obj.ObjectKey,
		ETag:               obj.ETag,
		SHA256:             obj.SHA256,
		Size:               obj.SizeBytes,
		ContentType:        obj.ContentType,
		ContentDisposition: obj.ContentDisposition,
		Metadata:           metadata,
		OwnerUserID:        obj.OwnerUserID,
		CreatedAt:          obj.CreatedAt,
		UpdatedAt:          obj.UpdatedAt,
	}
}

func (s *ObjectService) paths(bucket, key string) (string, string, string, error) {
	parts := strings.Split(key, "/")
	for _, part := range parts {
		if part == "" || part == "." || part == ".." || !safeSegmentRe.MatchString(part) {
			return "", "", "", ErrInvalidObject
		}
	}
	storagePath := filepath.ToSlash(filepath.Join(bucket, key))
	finalPath := filepath.Join(s.cfg.StorageDataDir, filepath.FromSlash(storagePath))
	tempPath := filepath.Join(s.cfg.StorageDataDir, ".tmp", newID())
	root, err := filepath.Abs(s.cfg.StorageDataDir)
	if err != nil {
		return "", "", "", err
	}
	finalAbs, err := filepath.Abs(finalPath)
	if err != nil {
		return "", "", "", err
	}
	if !strings.HasPrefix(finalAbs, root+string(os.PathSeparator)) && finalAbs != root {
		return "", "", "", ErrInvalidObject
	}
	return tempPath, finalPath, storagePath, nil
}

func normalizeBucket(bucket, fallback string) string {
	bucket = strings.TrimSpace(bucket)
	if bucket == "" {
		return fallback
	}
	return bucket
}

func validBucket(bucket string) bool {
	if len(bucket) < 3 || len(bucket) > 63 {
		return false
	}
	return safeSegmentRe.MatchString(bucket)
}

func validObjectKey(key string) bool {
	return key != "" && len(key) <= 512 && !strings.Contains(key, "\\")
}

func cleanMetadata(input map[string]string) map[string]string {
	out := map[string]string{}
	for key, value := range input {
		k := strings.ToLower(strings.TrimSpace(key))
		if k == "" || len(k) > 64 {
			continue
		}
		out[k] = strings.TrimSpace(value)
	}
	return out
}

func SafeObjectKey(prefix, filename string) string {
	name := filepath.Base(filename)
	name = strings.TrimSpace(name)
	if name == "." || name == "/" || name == "" {
		name = "object"
	}
	name = safeFilename(name)
	prefix = strings.Trim(prefix, "/")
	if prefix == "" {
		return fmt.Sprintf("%s-%s", newID(), name)
	}
	return fmt.Sprintf("%s/%s-%s", prefix, newID(), name)
}

func safeFilename(name string) string {
	var builder strings.Builder
	for _, r := range name {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '_' || r == '-' || r == '=' {
			builder.WriteRune(r)
		} else {
			builder.WriteByte('_')
		}
	}
	out := strings.Trim(builder.String(), "._-")
	if out == "" {
		return "object"
	}
	return out
}

func newID() string {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(bytes[:])
}
