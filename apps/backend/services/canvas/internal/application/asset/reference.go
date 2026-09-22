package asset

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

const maxReferenceOwnerKeyLength = 60

var ErrInvalidReferenceInput = errors.New("invalid asset reference input")

type ReferenceScope struct {
	TenantID    string
	WorkspaceID *string
}

type ReferenceOwnerType string

const (
	ReferenceOwnerCanvasNodeAsset               ReferenceOwnerType = "CANVAS_NODE_ASSET"
	ReferenceOwnerVideoGenerationOutput         ReferenceOwnerType = "VIDEO_GENERATION_OUTPUT"
	ReferenceOwnerVideoGenerationFirstFrame     ReferenceOwnerType = "VIDEO_GENERATION_FIRST_FRAME"
	ReferenceOwnerVideoGenerationLastFrame      ReferenceOwnerType = "VIDEO_GENERATION_LAST_FRAME"
	ReferenceOwnerResourceAssetRevision         ReferenceOwnerType = "RESOURCE_ASSET_REVISION"
	ReferenceOwnerResourceAssetGenerationUpload ReferenceOwnerType = "RESOURCE_ASSET_GENERATION_UPLOAD"
	ReferenceOwnerImageGenerationOutput         ReferenceOwnerType = "IMAGE_GENERATION_OUTPUT"
	ReferenceOwnerOfficialAssetUpload           ReferenceOwnerType = "OFFICIAL_ASSET_UPLOAD"
)

func (value ReferenceOwnerType) Valid() bool {
	switch value {
	case ReferenceOwnerCanvasNodeAsset,
		ReferenceOwnerVideoGenerationOutput,
		ReferenceOwnerVideoGenerationFirstFrame,
		ReferenceOwnerVideoGenerationLastFrame,
		ReferenceOwnerResourceAssetRevision,
		ReferenceOwnerResourceAssetGenerationUpload,
		ReferenceOwnerImageGenerationOutput,
		ReferenceOwnerOfficialAssetUpload:
		return true
	default:
		return false
	}
}

type ReferenceOwner struct {
	Type ReferenceOwnerType
	Key  string
}

type AcquireAssetsInput struct {
	Scope    ReferenceScope
	Owner    ReferenceOwner
	AssetIDs []string
}

type ReleaseAssetsInput struct {
	Scope    ReferenceScope
	Owner    ReferenceOwner
	AssetIDs []string
}

type ReleaseAllAssetsInput struct {
	Scope ReferenceScope
	Owner ReferenceOwner
}

type ReferenceStore interface {
	AcquireReferences(context.Context, ReferenceScope, ReferenceOwner, []string, time.Time) error
	ReleaseReferences(context.Context, ReferenceScope, ReferenceOwner, []string) error
	ReleaseOwnerReferences(context.Context, ReferenceScope, ReferenceOwner) error
}

func (s *Service) ReleaseAllAssets(ctx context.Context, input ReleaseAllAssetsInput) error {
	if s.referenceStore == nil {
		return errno.New(errno.ErrInternalError)
	}
	scope := normalizeReferenceScope(input.Scope)
	owner, valid := normalizeReferenceOwner(input.Owner)
	if scope.TenantID == "" || !valid {
		return errno.New(errno.ErrInvalidArgument)
	}
	if err := s.referenceStore.ReleaseOwnerReferences(ctx, scope, owner); err != nil {
		if errors.Is(err, ErrInvalidReferenceInput) {
			return errno.Wrap(errno.ErrInvalidArgument, err)
		}
		return classifyRepositoryError(err)
	}
	return nil
}

func (s *Service) AcquireAssets(ctx context.Context, input AcquireAssetsInput) error {
	if s.referenceStore == nil {
		return errno.New(errno.ErrInternalError)
	}
	scope, owner, assetIDs, valid := normalizeReferenceMutation(input.Scope, input.Owner, input.AssetIDs)
	if !valid {
		return errno.New(errno.ErrInvalidArgument)
	}
	if err := s.referenceStore.AcquireReferences(ctx, scope, owner, assetIDs, s.clock.Now()); err != nil {
		if errors.Is(err, ErrInvalidReferenceInput) {
			return errno.Wrap(errno.ErrInvalidArgument, err)
		}
		return classifyRepositoryError(err)
	}
	return nil
}

func (s *Service) ReleaseAssets(ctx context.Context, input ReleaseAssetsInput) error {
	if s.referenceStore == nil {
		return errno.New(errno.ErrInternalError)
	}
	scope, owner, assetIDs, valid := normalizeReferenceMutation(input.Scope, input.Owner, input.AssetIDs)
	if !valid {
		return errno.New(errno.ErrInvalidArgument)
	}
	if err := s.referenceStore.ReleaseReferences(ctx, scope, owner, assetIDs); err != nil {
		if errors.Is(err, ErrInvalidReferenceInput) {
			return errno.Wrap(errno.ErrInvalidArgument, err)
		}
		return classifyRepositoryError(err)
	}
	return nil
}

func normalizeReferenceMutation(scope ReferenceScope, owner ReferenceOwner, assetIDs []string) (ReferenceScope, ReferenceOwner, []string, bool) {
	scope = normalizeReferenceScope(scope)
	owner, ownerValid := normalizeReferenceOwner(owner)
	if scope.TenantID == "" || !ownerValid || len(assetIDs) == 0 || len(assetIDs) > maxBatchGetIDs {
		return ReferenceScope{}, ReferenceOwner{}, nil, false
	}
	normalized := make([]string, 0, len(assetIDs))
	seen := make(map[string]struct{}, len(assetIDs))
	for _, value := range assetIDs {
		parsed, err := uuid.Parse(strings.TrimSpace(value))
		if err != nil || parsed.Version() != 7 || parsed.Variant() != uuid.RFC4122 {
			return ReferenceScope{}, ReferenceOwner{}, nil, false
		}
		assetID := parsed.String()
		if _, exists := seen[assetID]; exists {
			continue
		}
		seen[assetID] = struct{}{}
		normalized = append(normalized, assetID)
	}
	return scope, owner, normalized, true
}

func normalizeReferenceOwner(owner ReferenceOwner) (ReferenceOwner, bool) {
	owner.Key = strings.TrimSpace(owner.Key)
	return owner, owner.Type.Valid() && owner.Key != "" && utf8.RuneCountInString(owner.Key) <= maxReferenceOwnerKeyLength
}

func normalizeReferenceScope(scope ReferenceScope) ReferenceScope {
	scope.TenantID = strings.TrimSpace(scope.TenantID)
	if scope.WorkspaceID != nil {
		workspaceID := strings.TrimSpace(*scope.WorkspaceID)
		scope.WorkspaceID = &workspaceID
	}
	return scope
}
