package asset

import (
	"errors"
	"regexp"
	"slices"
	"strings"
	"time"
)

var (
	ErrInvalidAsset                  = errors.New("invalid asset")
	ErrInvalidOwner                  = errors.New("invalid asset owner")
	ErrInvalidMediaType              = errors.New("invalid asset media type")
	ErrInvalidProviderAssetReference = errors.New("invalid approved asset provider reference")
)

var reviewedAssetIDPattern = regexp.MustCompile(`^asset-[A-Za-z0-9._-]+$`)

type OwnerType int

const (
	OwnerProject OwnerType = iota + 1
	OwnerResource
	// OwnerOfficial 标记由受信对账为官方预置素材创建的内部 Asset。
	//
	// 官方 Asset 先于官方 Resource 存在（上传链路要先拿到 Asset 才能物化出
	// ResourceAsset），因此不能用 resourceID 作 owner；owner_id 复用官方 Resource 的按
	// scope 派生哨兵值。它不对应 projects/resources 中的任何行，所以写入时不做 owner 实体
	// 校验，GC 由 OFFICIAL_ASSET_UPLOAD 账本 owner 兜底。
	OwnerOfficial
)

func (o OwnerType) Valid() bool {
	return o == OwnerProject || o == OwnerResource || o == OwnerOfficial
}

type MediaType int
type BillingClass string

const (
	MediaImage MediaType = iota + 1
	MediaVideo
	MediaAudio
)

const (
	BillingBillable BillingClass = "billable"
	BillingBuiltin  BillingClass = "builtin"
	BillingBorrowed BillingClass = "borrowed"
)

func (b BillingClass) Valid() bool {
	return b == BillingBillable || b == BillingBuiltin || b == BillingBorrowed
}

func (m MediaType) Valid() bool {
	return m == MediaImage || m == MediaVideo || m == MediaAudio
}

func (m MediaType) SizeLimitBytes() (int64, bool) {
	switch m {
	case MediaImage:
		return 30 * 1024 * 1024, true
	case MediaVideo:
		return 200 * 1024 * 1024, true
	case MediaAudio:
		return 15 * 1024 * 1024, true
	default:
		return 0, false
	}
}

type ReviewStatus string

const (
	ReviewStatusSubmitting ReviewStatus = "SUBMITTING"
	ReviewStatusProcessing ReviewStatus = "PROCESSING"
	ReviewStatusApproved   ReviewStatus = "APPROVED"
	ReviewStatusFailed     ReviewStatus = "FAILED"
)

type Review struct {
	PackageID          string
	PackageName        string
	ModelIDs           []string
	SystemPresetModels bool
	ProviderAssetID    string
	FailureReason      string
	Status             ReviewStatus
	SubmittedAt        time.Time
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

func (a Asset) LatestReview() *Review {
	if len(a.Reviews) == 0 {
		return nil
	}
	return &a.Reviews[len(a.Reviews)-1]
}

func (a Asset) ProviderReferenceForModel(modelID string, systemPreset bool) (string, error) {
	for index := len(a.Reviews) - 1; index >= 0; index-- {
		review := a.Reviews[index]
		if review.Status != ReviewStatusApproved ||
			((!review.SystemPresetModels || !systemPreset) && !slices.Contains(review.ModelIDs, modelID)) {
			continue
		}
		return review.ProviderReference()
	}
	return "", nil
}

// ProviderReference returns the trusted-material reference for an approved
// asset. Non-approved assets deliberately have no provider reference and must
// continue through the ordinary URL path.
func (r Review) ProviderReference() (string, error) {
	if r.Status != ReviewStatusApproved {
		return "", nil
	}
	return ProviderAssetReference(r.ProviderAssetID)
}

func ProviderAssetReference(providerAssetID string) (string, error) {
	providerAssetID = strings.TrimSpace(providerAssetID)
	if len(providerAssetID) > 200 || !reviewedAssetIDPattern.MatchString(providerAssetID) {
		return "", ErrInvalidProviderAssetReference
	}
	return "asset://" + providerAssetID, nil
}

type Asset struct {
	ID                string
	TenantID          string
	WorkspaceID       *string
	OwnerType         OwnerType
	OwnerID           string
	CreationKey       string
	ArtifactID        string
	ArtifactNamespace string
	FileName          string
	MediaType         MediaType
	ContentType       string
	SizeBytes         int64
	BillingClass      BillingClass
	CreatedBy         string
	CreatedAt         time.Time
	Reviews           []Review
}

type NewInput struct {
	ID                string
	TenantID          string
	WorkspaceID       *string
	OwnerType         OwnerType
	OwnerID           string
	CreationKey       string
	ArtifactID        string
	ArtifactNamespace string
	FileName          string
	MediaType         MediaType
	ContentType       string
	SizeBytes         int64
	BillingClass      BillingClass
	CreatedBy         string
	Now               time.Time
}

func New(input NewInput) (Asset, error) {
	artifactNamespace := strings.TrimSpace(input.ArtifactNamespace)
	if !input.OwnerType.Valid() || strings.TrimSpace(input.OwnerID) == "" {
		return Asset{}, ErrInvalidOwner
	}
	if !input.MediaType.Valid() {
		return Asset{}, ErrInvalidMediaType
	}
	if strings.TrimSpace(input.ID) == "" || strings.TrimSpace(input.TenantID) == "" ||
		strings.TrimSpace(input.ArtifactID) == "" || strings.TrimSpace(input.FileName) == "" ||
		strings.TrimSpace(input.ContentType) == "" || len(artifactNamespace) > 64 || input.SizeBytes <= 0 ||
		strings.TrimSpace(input.CreatedBy) == "" || input.Now.IsZero() {
		return Asset{}, ErrInvalidAsset
	}
	billingClass := input.BillingClass
	if billingClass == "" {
		billingClass = BillingBillable
		if input.OwnerType == OwnerOfficial {
			billingClass = BillingBuiltin
		}
	}
	if !billingClass.Valid() {
		return Asset{}, ErrInvalidAsset
	}
	return Asset{
		ID: input.ID, TenantID: input.TenantID, WorkspaceID: cloneString(input.WorkspaceID),
		OwnerType: input.OwnerType, OwnerID: input.OwnerID, CreationKey: strings.TrimSpace(input.CreationKey),
		ArtifactID: input.ArtifactID, ArtifactNamespace: artifactNamespace,
		FileName: input.FileName, MediaType: input.MediaType, ContentType: input.ContentType,
		SizeBytes: input.SizeBytes, BillingClass: billingClass,
		CreatedBy: input.CreatedBy, CreatedAt: input.Now.UTC(),
	}, nil
}

func cloneString(value *string) *string {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}
