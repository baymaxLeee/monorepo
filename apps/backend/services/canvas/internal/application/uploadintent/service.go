package uploadintent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	applicationcoverimage "github.com/example/monorepo/canvas/internal/application/coverimage"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	"github.com/example/monorepo/canvas/internal/infrastructure/assetclient"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

type Purpose string

const (
	PurposeSource Purpose = "source"
	PurposeCover  Purpose = "cover"
)

type Scope struct {
	TenantID, WorkspaceID, UserID string
}

type PrepareInput struct {
	Scope
	ClientRef string
	Purpose   Purpose
	Filename  string
	MediaType string
	SizeBytes int64
}

type Plan struct {
	UploadSessionID string
	IntentID        string
	State           string
	UploadURL       string
	ExpiresAt       time.Time
	Filename        string
	MediaType       string
	SizeBytes       int64
	AssetID         string
	RevisionID      string
}

type SessionCreator interface {
	CreateUploadSession(context.Context, assetclient.CreateUploadSessionInput) (assetclient.UploadSession, error)
}

type Service struct{ sessions SessionCreator }

func New(sessions SessionCreator) *Service { return &Service{sessions: sessions} }

func (s *Service) Prepare(ctx context.Context, input PrepareInput) (Plan, error) {
	input.TenantID = strings.TrimSpace(input.TenantID)
	input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
	input.UserID = strings.TrimSpace(input.UserID)
	input.ClientRef = strings.TrimSpace(input.ClientRef)
	input.Filename = strings.TrimSpace(input.Filename)
	input.MediaType = strings.ToLower(strings.TrimSpace(strings.Split(input.MediaType, ";")[0]))
	if s == nil || s.sessions == nil || input.TenantID == "" || input.UserID == "" || input.ClientRef == "" ||
		input.Filename == "" || input.MediaType == "" || input.SizeBytes <= 0 || len(input.ClientRef) > 255 {
		return Plan{}, errno.New(errno.ErrInvalidArgument)
	}
	category, err := validatePolicy(input.Purpose, input.MediaType, input.SizeBytes)
	if err != nil {
		return Plan{}, err
	}
	digest := sha256.Sum256([]byte(input.TenantID + "\x00" + input.WorkspaceID + "\x00" + input.UserID + "\x00" + string(input.Purpose) + "\x00" + input.ClientRef))
	intentID := "canvas-" + string(input.Purpose) + ":" + hex.EncodeToString(digest[:])
	session, err := s.sessions.CreateUploadSession(ctx, assetclient.CreateUploadSessionInput{
		TenantID: input.TenantID, WorkspaceID: input.WorkspaceID, UserID: input.UserID,
		Filename: input.Filename, MediaType: input.MediaType, Category: category,
		IdempotencyKey: intentID, SizeBytes: input.SizeBytes,
	})
	if err != nil {
		return Plan{}, err
	}
	return Plan{
		UploadSessionID: session.UploadSessionID, IntentID: session.IntentID, State: session.State,
		UploadURL: session.UploadURL, ExpiresAt: session.ExpiresAt, Filename: session.Filename,
		MediaType: session.MediaType, SizeBytes: session.SizeBytes, AssetID: session.AssetID, RevisionID: session.RevisionID,
	}, nil
}

func validatePolicy(purpose Purpose, mediaType string, sizeBytes int64) (string, error) {
	switch purpose {
	case PurposeCover:
		if sizeBytes > applicationcoverimage.MaximumBytes {
			return "", errno.New(errno.ErrAssetTooLarge)
		}
		if !applicationcoverimage.SupportedMediaType(mediaType) {
			return "", errno.New(errno.ErrUnsupportedAssetFormat)
		}
		return "canvas-cover", nil
	case PurposeSource:
		var kind domainasset.MediaType
		switch {
		case strings.HasPrefix(mediaType, "image/"):
			kind = domainasset.MediaImage
		case strings.HasPrefix(mediaType, "video/"):
			kind = domainasset.MediaVideo
		case strings.HasPrefix(mediaType, "audio/"):
			kind = domainasset.MediaAudio
		default:
			return "", errno.New(errno.ErrUnsupportedAssetFormat)
		}
		limit, ok := kind.SizeLimitBytes()
		if !ok {
			return "", errno.Wrap(errno.ErrInternalError, errors.New("missing media size policy"))
		}
		if sizeBytes > limit {
			return "", errno.New(errno.ErrAssetTooLarge)
		}
		return "canvas-source", nil
	default:
		return "", errno.New(errno.ErrInvalidArgument)
	}
}
