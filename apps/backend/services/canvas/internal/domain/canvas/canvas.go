package canvas

import (
	"errors"
	"time"
	"unicode"
	"unicode/utf8"
)

var (
	ErrInvalidName                = errors.New("invalid canvas name")
	ErrInvalidCoverImageReference = errors.New("invalid canvas cover image revision reference")
)

type ViewMode int16

const (
	ViewModeCanvas ViewMode = iota + 1
	ViewModeStoryboard
)

func (m ViewMode) Valid() bool { return m == ViewModeCanvas || m == ViewModeStoryboard }

type Canvas struct {
	ID                          string
	TenantID                    string
	WorkspaceID                 *string
	ProjectID                   string
	Name                        string
	CoverImageAssetID           string
	CoverImageRevisionID        string
	CoverImageSHA256            string
	CoverImageContentType       string
	CoverImageSizeBytes         int64
	CoverImageClaimGeneration   int64
	CoverImageURL               string
	CreatedBy                   string
	CreatedAt                   time.Time
	UpdatedAt                   time.Time
	DeletedAt                   *time.Time
	CanvasNodeCount             int32
	SelectedVideoDurationMillis int64
	FallbackCoverImageURL       string
	DefaultView                 ViewMode
	Revision                    int64
}

type NewInput struct {
	ID                                      string
	TenantID                                string
	WorkspaceID                             *string
	ProjectID                               string
	Name                                    string
	CoverImageAssetID, CoverImageRevisionID string
	CreatedBy                               string
	Now                                     time.Time
}

func New(input NewInput) (Canvas, error) {
	if err := validateName(input.Name); err != nil {
		return Canvas{}, err
	}
	if !validCoverReference(input.CoverImageAssetID, input.CoverImageRevisionID) {
		return Canvas{}, ErrInvalidCoverImageReference
	}
	return Canvas{
		ID:                input.ID,
		TenantID:          input.TenantID,
		WorkspaceID:       cloneString(input.WorkspaceID),
		ProjectID:         input.ProjectID,
		Name:              input.Name,
		CoverImageAssetID: input.CoverImageAssetID, CoverImageRevisionID: input.CoverImageRevisionID,
		CreatedBy:   input.CreatedBy,
		CreatedAt:   input.Now,
		UpdatedAt:   input.Now,
		DefaultView: ViewModeStoryboard,
		Revision:    1,
	}, nil
}

func (v *Canvas) Update(name string, coverImageAssetID, coverImageRevisionID *string, now time.Time) error {
	if err := validateName(name); err != nil {
		return err
	}
	if (coverImageAssetID == nil) != (coverImageRevisionID == nil) {
		return ErrInvalidCoverImageReference
	}
	v.Name = name
	if coverImageAssetID != nil {
		if !validCoverReference(*coverImageAssetID, *coverImageRevisionID) {
			return ErrInvalidCoverImageReference
		}
		if v.CoverImageAssetID != *coverImageAssetID || v.CoverImageRevisionID != *coverImageRevisionID {
			v.CoverImageSHA256 = ""
			v.CoverImageContentType = ""
			v.CoverImageSizeBytes = 0
		}
		v.CoverImageAssetID, v.CoverImageRevisionID = *coverImageAssetID, *coverImageRevisionID
	}
	v.Revision++
	v.UpdatedAt = now
	return nil
}

func validCoverReference(assetID, revisionID string) bool {
	return assetID == "" && revisionID == "" || assetID != "" && revisionID != ""
}

func (v *Canvas) Delete(now time.Time) error {
	v.Revision++
	v.DeletedAt = &now
	v.UpdatedAt = now
	return nil
}

func validateName(name string) error {
	if !utf8.ValidString(name) {
		return ErrInvalidName
	}
	runes := []rune(name)
	if len(runes) < 1 || len(runes) > 20 {
		return ErrInvalidName
	}
	if invalidBoundaryRune(runes[0]) || invalidBoundaryRune(runes[len(runes)-1]) {
		return ErrInvalidName
	}
	return nil
}

func invalidBoundaryRune(value rune) bool {
	return value == '-' || value == '_' || unicode.IsSpace(value)
}

func cloneString(value *string) *string {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}
