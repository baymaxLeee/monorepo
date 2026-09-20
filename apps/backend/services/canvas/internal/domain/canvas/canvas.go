package canvas

import (
	"errors"
	"time"
	"unicode"
	"unicode/utf8"
)

var (
	ErrInvalidName           = errors.New("invalid canvas name")
	ErrInvalidCoverImagePath = errors.New("invalid canvas cover image path")
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
	CoverImagePath              *string
	CoverImageID                string
	CoverImageSHA256            string
	CoverImageSizeBytes         int64
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
	ID             string
	TenantID       string
	WorkspaceID    *string
	ProjectID      string
	Name           string
	CoverImagePath *string
	CreatedBy      string
	Now            time.Time
}

func New(input NewInput) (Canvas, error) {
	if err := validateName(input.Name); err != nil {
		return Canvas{}, err
	}
	coverImagePath, err := normalizeCoverImagePath(input.CoverImagePath)
	if err != nil {
		return Canvas{}, err
	}
	return Canvas{
		ID:             input.ID,
		TenantID:       input.TenantID,
		WorkspaceID:    cloneString(input.WorkspaceID),
		ProjectID:      input.ProjectID,
		Name:           input.Name,
		CoverImagePath: coverImagePath,
		CreatedBy:      input.CreatedBy,
		CreatedAt:      input.Now,
		UpdatedAt:      input.Now,
		DefaultView:    ViewModeStoryboard,
		Revision:       1,
	}, nil
}

func (v *Canvas) Update(name string, coverImagePath *string, now time.Time) error {
	if err := validateName(name); err != nil {
		return err
	}
	normalizedCoverImagePath, err := normalizeCoverImagePath(coverImagePath)
	if err != nil {
		return err
	}
	v.Name = name
	if coverImagePath != nil {
		if !stringPointersEqual(v.CoverImagePath, normalizedCoverImagePath) {
			v.CoverImageID = ""
			v.CoverImageSHA256 = ""
			v.CoverImageSizeBytes = 0
		}
		v.CoverImagePath = normalizedCoverImagePath
	}
	v.Revision++
	v.UpdatedAt = now
	return nil
}

func normalizeCoverImagePath(value *string) (*string, error) {
	if value == nil || *value == "" {
		return nil, nil
	}
	if utf8.RuneCountInString(*value) > 128 {
		return nil, ErrInvalidCoverImagePath
	}
	return cloneString(value), nil
}

func stringPointersEqual(left, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
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
