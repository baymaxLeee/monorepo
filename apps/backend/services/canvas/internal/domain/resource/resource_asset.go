package resource

import (
	"errors"
	"path"
	"strconv"
	"strings"
	"time"

	"golang.org/x/text/unicode/norm"

	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
)

var (
	ErrInvalidResourceAsset            = errors.New("invalid resource asset")
	ErrResourceAssetRevisionConflict   = errors.New("resource asset revision conflict")
	ErrResourceAssetSourceTypeMismatch = errors.New("resource asset source type mismatch")
)

type SourceType int16

const (
	SourceUpload SourceType = iota + 1
	SourceGenerated
)

func (source SourceType) Valid() bool {
	return source == SourceUpload || source == SourceGenerated
}

type ResourceAsset struct {
	ID                     string
	ResourceID             string
	Name                   string
	SequenceNo             int64
	SourceType             SourceType
	CurrentAssetID         string
	ImageGenerationDraftID string
	MediaType              domainasset.MediaType
	Revision               int64
	CreatedAt              time.Time
	UpdatedAt              time.Time
	DeletedAt              *time.Time
}

type NewResourceAssetInput struct {
	ID             string
	ResourceID     string
	Name           string
	SequenceNo     int64
	CurrentAssetID string
	MediaType      domainasset.MediaType
	Now            time.Time
}

func NewResourceAsset(input NewResourceAssetInput) (ResourceAsset, error) {
	if strings.TrimSpace(input.ID) == "" || strings.TrimSpace(input.ResourceID) == "" ||
		input.SequenceNo < 1 || strings.TrimSpace(input.CurrentAssetID) == "" ||
		!input.MediaType.Valid() || input.Now.IsZero() {
		return ResourceAsset{}, ErrInvalidResourceAsset
	}
	if err := validateName(input.Name); err != nil {
		return ResourceAsset{}, err
	}
	return ResourceAsset{
		ID: input.ID, ResourceID: input.ResourceID, Name: input.Name, SequenceNo: input.SequenceNo,
		SourceType: SourceUpload, CurrentAssetID: input.CurrentAssetID, MediaType: input.MediaType, Revision: 1,
		CreatedAt: input.Now.UTC(), UpdatedAt: input.Now.UTC(),
	}, nil
}

type NewGeneratedResourceAssetInput struct {
	ID                     string
	ResourceID             string
	ResourceName           string
	SequenceNo             int64
	ImageGenerationDraftID string
	Now                    time.Time
}

func NewGeneratedResourceAsset(input NewGeneratedResourceAssetInput) (ResourceAsset, error) {
	if strings.TrimSpace(input.ID) == "" || strings.TrimSpace(input.ResourceID) == "" ||
		strings.TrimSpace(input.ImageGenerationDraftID) == "" || input.Now.IsZero() {
		return ResourceAsset{}, ErrInvalidResourceAsset
	}
	name, err := GeneratedResourceAssetName(input.ResourceName, input.SequenceNo)
	if err != nil {
		return ResourceAsset{}, err
	}
	return ResourceAsset{
		ID: input.ID, ResourceID: input.ResourceID, Name: name, SequenceNo: input.SequenceNo,
		SourceType: SourceGenerated, ImageGenerationDraftID: input.ImageGenerationDraftID,
		MediaType: domainasset.MediaImage, Revision: 1,
		CreatedAt: input.Now.UTC(), UpdatedAt: input.Now.UTC(),
	}, nil
}

func GeneratedResourceAssetName(resourceName string, sequenceNo int64) (string, error) {
	if sequenceNo < 1 {
		return "", ErrInvalidResourceAsset
	}
	suffix := " " + strconv.FormatInt(sequenceNo, 10)
	resourceRunes := []rune(resourceName)
	maximumResourceRunes := maxNameRunes - len([]rune(suffix))
	if maximumResourceRunes < 1 || len(resourceRunes) < 1 {
		return "", ErrInvalidResourceAsset
	}
	if len(resourceRunes) > maximumResourceRunes {
		resourceRunes = resourceRunes[:maximumResourceRunes]
	}
	name := string(resourceRunes) + suffix
	if err := validateName(name); err != nil {
		return "", ErrInvalidResourceAsset
	}
	return name, nil
}

func DefaultResourceAssetName(fileName string) string {
	base := path.Base(strings.ReplaceAll(fileName, `\`, "/"))
	name := norm.NFC.String(strings.TrimSpace(strings.TrimSuffix(base, path.Ext(base))))
	runes := []rune(name)
	if len(runes) > maxNameRunes {
		return string(runes[:maxNameRunes])
	}
	return name
}

func ValidateResourceAssetName(name string) error {
	return validateName(name)
}

func (a *ResourceAsset) UpdateName(name string, expectedRevision int64, now time.Time) (bool, error) {
	if a.Revision != expectedRevision {
		return false, ErrResourceAssetRevisionConflict
	}
	if err := validateName(name); err != nil {
		return false, err
	}
	if a.Name == name {
		return false, nil
	}
	a.Name = name
	a.Revision++
	a.UpdatedAt = now.UTC()
	return true, nil
}

func (a *ResourceAsset) SelectAsset(assetID string, mediaType domainasset.MediaType, expectedRevision int64, now time.Time) (bool, error) {
	return a.SelectUploadedAsset(assetID, mediaType, expectedRevision, now)
}

func (a *ResourceAsset) SelectUploadedAsset(assetID string, mediaType domainasset.MediaType, expectedRevision int64, now time.Time) (bool, error) {
	if a.Revision != expectedRevision {
		return false, ErrResourceAssetRevisionConflict
	}
	if a.SourceType != SourceUpload {
		return false, ErrResourceAssetSourceTypeMismatch
	}
	if strings.TrimSpace(assetID) == "" || !mediaType.Valid() {
		return false, ErrInvalidResourceAsset
	}
	if a.CurrentAssetID == assetID {
		return false, nil
	}
	a.CurrentAssetID = assetID
	a.MediaType = mediaType
	a.Revision++
	a.UpdatedAt = now.UTC()
	return true, nil
}

func (a *ResourceAsset) ApplyGeneratedAsset(assetID, imageGenerationDraftID string, now time.Time) error {
	if a.SourceType != SourceGenerated || a.ImageGenerationDraftID != imageGenerationDraftID {
		return ErrResourceAssetSourceTypeMismatch
	}
	if strings.TrimSpace(assetID) == "" || now.IsZero() {
		return ErrInvalidResourceAsset
	}
	if a.CurrentAssetID == assetID {
		return nil
	}
	a.CurrentAssetID = assetID
	a.MediaType = domainasset.MediaImage
	a.Revision++
	a.UpdatedAt = now.UTC()
	return nil
}

func (a *ResourceAsset) ClearGeneratedAsset(imageGenerationDraftID string, now time.Time) error {
	if a.SourceType != SourceGenerated || a.ImageGenerationDraftID != imageGenerationDraftID {
		return ErrResourceAssetSourceTypeMismatch
	}
	if now.IsZero() {
		return ErrInvalidResourceAsset
	}
	if a.CurrentAssetID == "" {
		return nil
	}
	a.CurrentAssetID = ""
	a.Revision++
	a.UpdatedAt = now.UTC()
	return nil
}

// Update applies all requested binding changes as one optimistic-lock mutation.
func (a *ResourceAsset) Update(name, assetID *string, mediaType *domainasset.MediaType, expectedRevision int64, now time.Time) (bool, error) {
	if a.Revision != expectedRevision {
		return false, ErrResourceAssetRevisionConflict
	}
	if name != nil {
		if err := validateName(*name); err != nil {
			return false, err
		}
	}
	if assetID != nil {
		if a.SourceType != SourceUpload {
			return false, ErrResourceAssetSourceTypeMismatch
		}
		if strings.TrimSpace(*assetID) == "" || mediaType == nil || !mediaType.Valid() {
			return false, ErrInvalidResourceAsset
		}
	} else if mediaType != nil {
		return false, ErrInvalidResourceAsset
	}
	changed := (name != nil && a.Name != *name) || (assetID != nil && a.CurrentAssetID != *assetID)
	if !changed {
		return false, nil
	}
	if name != nil {
		a.Name = *name
	}
	if assetID != nil {
		a.CurrentAssetID = *assetID
		a.MediaType = *mediaType
	}
	a.Revision++
	a.UpdatedAt = now.UTC()
	return true, nil
}

func (a *ResourceAsset) Delete(expectedRevision int64, now time.Time) error {
	if a.Revision != expectedRevision {
		return ErrResourceAssetRevisionConflict
	}
	deletedAt := now.UTC()
	a.DeletedAt = &deletedAt
	a.UpdatedAt = deletedAt
	a.Revision++
	return nil
}
