package coverimage

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"

	applicationcoverimage "github.com/example/monorepo/canvas/internal/application/coverimage"
	"github.com/example/monorepo/canvas/internal/infrastructure/storage"
)

const (
	maximumCoverImageBytes int64 = 2 << 20
	stagingNamespace             = "agentframe:blob-staging"
)

var blobIDPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

type IDGenerator interface {
	NewID() (string, error)
}

type Store struct {
	storage          *storage.Client
	ids              IDGenerator
	publicGatewayURL string
}

func New(storageClient *storage.Client, ids IDGenerator, publicGatewayURL string) *Store {
	return &Store{
		storage: storageClient, ids: ids,
		publicGatewayURL: strings.TrimRight(publicGatewayURL, "/"),
	}
}

func (s *Store) Register(ctx context.Context, _, _ string, blobID string) (applicationcoverimage.Registration, error) {
	blobID = strings.TrimSpace(blobID)
	if !blobIDPattern.MatchString(blobID) {
		return applicationcoverimage.Registration{}, applicationcoverimage.ErrInvalidReference
	}
	reader, err := s.storage.Get(ctx, knowledgeNamespace(stagingNamespace), blobID)
	if err != nil {
		return applicationcoverimage.Registration{}, fmt.Errorf("open staged cover image: %w", err)
	}
	defer reader.Close()
	content, err := io.ReadAll(io.LimitReader(reader, maximumCoverImageBytes+1))
	if err != nil {
		return applicationcoverimage.Registration{}, fmt.Errorf("read staged cover image: %w", err)
	}
	if int64(len(content)) > maximumCoverImageBytes {
		return applicationcoverimage.Registration{}, applicationcoverimage.ErrTooLarge
	}
	contentType := http.DetectContentType(content)
	if len(content) == 0 || (contentType != "image/png" && contentType != "image/jpeg") {
		return applicationcoverimage.Registration{}, applicationcoverimage.ErrUnsupportedFormat
	}
	id, err := s.ids.NewID()
	if err != nil {
		return applicationcoverimage.Registration{}, applicationcoverimage.ErrIDGeneration
	}
	stored, err := s.storage.PutObject(ctx, knowledgeNamespace(coverNamespace(id)), bytes.NewReader(content))
	if err != nil {
		return applicationcoverimage.Registration{}, fmt.Errorf("store cover image: %w", err)
	}
	if stored.ArtifactID == "" || stored.SHA256 == "" || stored.Size != int64(len(content)) {
		if stored.ArtifactID != "" {
			_ = s.storage.Delete(context.WithoutCancel(ctx), knowledgeNamespace(coverNamespace(id)), stored.ArtifactID)
		}
		return applicationcoverimage.Registration{}, errors.New("stored cover image integrity mismatch")
	}
	return applicationcoverimage.Registration{
		Path: blobID, ID: id, SHA256: stored.ArtifactID,
		ContentType: contentType, SizeBytes: stored.Size,
	}, nil
}

func (s *Store) Release(ctx context.Context, registration applicationcoverimage.Registration) error {
	if registration.ID == "" || registration.SHA256 == "" {
		return errors.New("invalid cover image registration")
	}
	return s.storage.Delete(ctx, knowledgeNamespace(coverNamespace(registration.ID)), registration.SHA256)
}

func (s *Store) Presign(
	ctx context.Context,
	registrations []applicationcoverimage.Registration,
) (map[string]string, error) {
	items := make([]storage.Artifact, 0, len(registrations))
	for _, registration := range registrations {
		if registration.ID == "" || registration.SHA256 == "" || registration.ContentType == "" {
			continue
		}
		items = append(items, storage.Artifact{
			Namespace: knowledgeNamespace(coverNamespace(registration.ID)),
			ID:        registration.SHA256, ContentType: registration.ContentType,
		})
	}
	presigned, err := s.storage.BatchPublicURLs(ctx, items)
	if err != nil {
		return nil, fmt.Errorf("presign cover images: %w", err)
	}
	result := make(map[string]string, len(registrations))
	for _, registration := range registrations {
		namespace := knowledgeNamespace(coverNamespace(registration.ID))
		item, ok := presigned[storage.ArtifactLookupKey(namespace, registration.SHA256)]
		if !ok || strings.TrimSpace(item.URL) == "" {
			continue
		}
		result[registration.ID] = s.absoluteURL(item.URL)
	}
	return result, nil
}

func coverNamespace(id string) string {
	return "canvas:cover:" + strings.TrimSpace(id)
}

func knowledgeNamespace(namespace string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(namespace)))
	return hex.EncodeToString(digest[:])
}

func (s *Store) absoluteURL(value string) string {
	if strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://") || s.publicGatewayURL == "" {
		return value
	}
	if strings.HasPrefix(value, "/") {
		return s.publicGatewayURL + value
	}
	return s.publicGatewayURL + "/" + value
}
