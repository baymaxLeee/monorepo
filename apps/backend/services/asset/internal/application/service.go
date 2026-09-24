package application

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"time"

	"github.com/example/monorepo/asset/internal/domain"
	"github.com/google/uuid"
)

var (
	ErrInvalidInput = errors.New("invalid asset input")
	ErrNotFound     = errors.New("asset not found")
	ErrConflict     = errors.New("asset state conflict")
)

type Clock interface{ Now() time.Time }

type Service struct {
	repository Repository
	storage    BlobStore
	clock      Clock
	maxBytes   int64
}

func NewService(repository Repository, storage BlobStore, clock Clock, maxBytes int64) *Service {
	return &Service{repository: repository, storage: storage, clock: clock, maxBytes: maxBytes}
}

func (s *Service) Upload(ctx context.Context, input CreateUploadInput, body io.Reader) (domain.Asset, domain.Revision, error) {
	filename := strings.TrimSpace(input.Filename)
	input.CallerService = strings.TrimSpace(input.CallerService)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	if input.TenantID == "" || input.UserID == "" || filename == "" || input.Category == "" || input.CallerService == "" ||
		(input.CallerService != "browser" && input.IdempotencyKey == "") || len(input.IdempotencyKey) > 255 || body == nil {
		return domain.Asset{}, domain.Revision{}, ErrInvalidInput
	}
	input.Filename = filepath.Base(filename)
	if input.Filename == "." {
		return domain.Asset{}, domain.Revision{}, ErrInvalidInput
	}
	now := s.clock.Now()
	uploadID := uuid.Must(uuid.NewV7()).String()
	started, err := s.repository.BeginUpload(ctx, input, uploadID, now.Add(24*time.Hour), now)
	if err != nil {
		return domain.Asset{}, domain.Revision{}, err
	}
	if started.Completed {
		asset, revision, _, lookupErr := s.repository.GetRevision(
			ctx,
			input.TenantID,
			input.WorkspaceID,
			started.AssetID,
			started.RevisionID,
		)
		return asset, revision, lookupErr
	}
	return s.persistUpload(ctx, UploadSession{
		ID: started.UploadID, TenantID: input.TenantID, WorkspaceID: input.WorkspaceID, UserID: input.UserID,
		CallerService: input.CallerService, IdempotencyKey: input.IdempotencyKey, Category: input.Category,
		Filename: input.Filename, MediaType: input.MediaType, SizeBytes: -1, State: "uploading",
	}, body)
}

func (s *Service) CreateUploadSession(ctx context.Context, input CreateUploadSessionInput) (UploadSession, error) {
	input.TenantID = strings.TrimSpace(input.TenantID)
	input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
	input.UserID = strings.TrimSpace(input.UserID)
	input.CallerService = strings.TrimSpace(input.CallerService)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.Category = strings.TrimSpace(input.Category)
	input.MediaType = strings.TrimSpace(input.MediaType)
	filename := strings.TrimSpace(input.Filename)
	if input.TenantID == "" || input.UserID == "" || input.CallerService == "" || input.IdempotencyKey == "" ||
		input.Category == "" || input.MediaType == "" || filename == "" || len(input.IdempotencyKey) > 255 ||
		input.SizeBytes < 0 || input.SizeBytes > s.maxBytes {
		return UploadSession{}, ErrInvalidInput
	}
	input.Filename = filepath.Base(filename)
	if input.Filename == "." {
		return UploadSession{}, ErrInvalidInput
	}
	now := s.clock.Now()
	session, err := s.repository.CreateUploadSession(ctx, input, uuid.Must(uuid.NewV7()).String(), now.Add(24*time.Hour), now)
	if err != nil {
		return UploadSession{}, err
	}
	if !session.ExpiresAt.After(now) {
		return UploadSession{}, ErrConflict
	}
	return session, nil
}

func (s *Service) UploadSession(ctx context.Context, sessionID string, body io.Reader) (domain.Asset, domain.Revision, error) {
	if strings.TrimSpace(sessionID) == "" || body == nil {
		return domain.Asset{}, domain.Revision{}, ErrInvalidInput
	}
	session, err := s.repository.ClaimUploadSession(ctx, sessionID, s.clock.Now())
	if err != nil {
		return domain.Asset{}, domain.Revision{}, err
	}
	if session.State == "completed" {
		asset, revision, _, lookupErr := s.repository.GetRevision(
			ctx, session.TenantID, session.WorkspaceID, session.AssetID, session.RevisionID,
		)
		return asset, revision, lookupErr
	}
	return s.persistUpload(ctx, session, body)
}

func (s *Service) DescribeUploadSession(
	ctx context.Context,
	callerService, tenantID, workspaceID, sessionID string,
) (UploadSession, error) {
	if strings.TrimSpace(callerService) == "" || strings.TrimSpace(tenantID) == "" || strings.TrimSpace(sessionID) == "" {
		return UploadSession{}, ErrInvalidInput
	}
	session, err := s.repository.GetUploadSession(ctx, callerService, tenantID, workspaceID, sessionID)
	if err != nil {
		return UploadSession{}, err
	}
	if !session.ExpiresAt.After(s.clock.Now()) {
		return UploadSession{}, ErrConflict
	}
	return session, nil
}

func (s *Service) persistUpload(ctx context.Context, session UploadSession, body io.Reader) (domain.Asset, domain.Revision, error) {
	uploadID := session.ID
	limit := s.maxBytes
	if session.SizeBytes >= 0 && session.SizeBytes < limit {
		limit = session.SizeBytes
	}
	if limit < 1 {
		limit = 1
	}
	staged, err := s.storage.Stage(ctx, uploadID, body, limit)
	if err != nil {
		_ = s.repository.FailUpload(context.WithoutCancel(ctx), uploadID, "storage_write_failed", s.clock.Now())
		return domain.Asset{}, domain.Revision{}, err
	}
	if len(staged.SHA256) != sha256.Size*2 || staged.SizeBytes < 0 {
		_ = s.storage.Abort(context.WithoutCancel(ctx), staged)
		_ = s.repository.FailUpload(context.WithoutCancel(ctx), uploadID, "invalid_staged_blob", s.clock.Now())
		return domain.Asset{}, domain.Revision{}, ErrInvalidInput
	}
	if session.SizeBytes >= 0 && staged.SizeBytes != session.SizeBytes {
		_ = s.storage.Abort(context.WithoutCancel(ctx), staged)
		_ = s.repository.FailUpload(context.WithoutCancel(ctx), uploadID, "size_mismatch", s.clock.Now())
		return domain.Asset{}, domain.Revision{}, ErrInvalidInput
	}
	assetID := uuid.Must(uuid.NewV7()).String()
	revisionID := uuid.Must(uuid.NewV7()).String()
	blobID := uuid.Must(uuid.NewV7()).String()
	tenantDigest := sha256.Sum256([]byte(session.TenantID))
	storageKey := fmt.Sprintf("blobs/%s/%s/%s/%s/%s", hex.EncodeToString(tenantDigest[:8]), staged.SHA256[:2], staged.SHA256[2:4], staged.SHA256, blobID)
	if err = s.storage.Commit(ctx, staged, storageKey); err != nil {
		_ = s.storage.Abort(context.WithoutCancel(ctx), staged)
		_ = s.repository.FailUpload(context.WithoutCancel(ctx), uploadID, "storage_commit_failed", s.clock.Now())
		return domain.Asset{}, domain.Revision{}, err
	}
	mediaType := staged.DetectedMediaType
	if mediaType == "application/octet-stream" && session.MediaType != "" {
		mediaType = session.MediaType
	}
	completedAt := s.clock.Now()
	result, err := s.repository.CompleteUpload(ctx, CompleteUploadInput{
		UploadID: uploadID, AssetID: assetID, RevisionID: revisionID, BlobID: blobID, StorageKey: storageKey,
		UploadClaimID: uuid.Must(uuid.NewV7()).String(),
		SHA256:        staged.SHA256, Filename: session.Filename, MediaType: mediaType, Category: session.Category,
		TenantID: session.TenantID, WorkspaceID: session.WorkspaceID, UserID: session.UserID, SizeBytes: staged.SizeBytes,
		Now: completedAt, UploadLeaseExpiresAt: completedAt.Add(24 * time.Hour),
	})
	if err != nil {
		_ = s.repository.FailUpload(context.WithoutCancel(ctx), uploadID, "metadata_commit_failed", s.clock.Now())
		// The canonical blob is deliberately retained. A later orphan scrub can
		// prove it has no metadata before deleting it; an ambiguous DB commit must
		// never destroy bytes that may already be referenced.
		return domain.Asset{}, domain.Revision{}, err
	}
	if result.UnusedStorageKey != "" {
		// Dedupe is decided transactionally. This upload's private physical copy
		// is now an orphan and cannot be referenced by another Blob row.
		_ = s.storage.Delete(context.WithoutCancel(ctx), result.UnusedStorageKey)
	}
	return result.Asset, result.Revision, nil
}

func (s *Service) Open(ctx context.Context, tenantID, workspaceID, assetID, revisionID string) (domain.Revision, BlobReader, error) {
	_, revision, key, err := s.repository.GetRevision(ctx, tenantID, workspaceID, assetID, revisionID)
	if err != nil {
		return domain.Revision{}, BlobReader{}, err
	}
	reader, err := s.storage.Open(ctx, key)
	return revision, reader, err
}

func (s *Service) Describe(ctx context.Context, tenantID, workspaceID, assetID, revisionID string) (domain.Asset, domain.Revision, error) {
	if tenantID == "" || assetID == "" || revisionID == "" {
		return domain.Asset{}, domain.Revision{}, ErrInvalidInput
	}
	asset, revision, _, err := s.repository.GetRevision(ctx, tenantID, workspaceID, assetID, revisionID)
	return asset, revision, err
}

func (s *Service) PrepareClaim(ctx context.Context, input PrepareClaimInput) (domain.Claim, error) {
	if input.TenantID == "" || input.OwnerService == "" || input.OwnerType == "" || input.OwnerID == "" || input.Slot == "" || input.AssetID == "" || input.Generation < 1 {
		return domain.Claim{}, ErrInvalidInput
	}
	if input.Kind != domain.ClaimStrong && input.Kind != domain.ClaimSnapshot && input.Kind != domain.ClaimLease && input.Kind != domain.ClaimWeak {
		return domain.Claim{}, ErrInvalidInput
	}
	if input.Kind == domain.ClaimLease && (input.ExpiresAt == nil || !input.ExpiresAt.After(s.clock.Now())) {
		return domain.Claim{}, ErrInvalidInput
	}
	return s.repository.PrepareClaim(ctx, input, uuid.Must(uuid.NewV7()).String(), s.clock.Now())
}

func (s *Service) ActivateClaim(ctx context.Context, input ClaimMutationInput) (domain.Claim, error) {
	if !validClaimMutation(input) {
		return domain.Claim{}, ErrInvalidInput
	}
	return s.repository.ActivateClaim(ctx, input, s.clock.Now())
}

func (s *Service) ReleaseClaim(ctx context.Context, input ClaimMutationInput) (domain.Claim, error) {
	if !validClaimMutation(input) {
		return domain.Claim{}, ErrInvalidInput
	}
	return s.repository.ReleaseClaim(ctx, input, s.clock.Now())
}

func validClaimMutation(input ClaimMutationInput) bool {
	return input.TenantID != "" && input.OwnerService != "" && input.OwnerType != "" && input.OwnerID != "" && input.Slot != "" && input.Generation > 0
}
