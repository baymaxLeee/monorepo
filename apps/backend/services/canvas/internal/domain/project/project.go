package project

import (
	"errors"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

var (
	ErrInvalidName                = errors.New("invalid project name")
	ErrInvalidCoverImageReference = errors.New("invalid project cover image revision reference")
	ErrMembersRequired            = errors.New("project members required")
)

type Project struct {
	ID                          string
	TenantID                    string
	WorkspaceID                 *string
	Name                        string
	CreatedBy                   string
	CoverImageAssetID           string
	CoverImageRevisionID        string
	CoverImageSHA256            string
	CoverImageContentType       string
	CoverImageSizeBytes         int64
	CoverImageClaimGeneration   int64
	CoverImageURL               string
	MemberIDs                   []string
	CreatedAt                   time.Time
	UpdatedAt                   time.Time
	DeletedAt                   *time.Time
	CanvasCount                 int32
	SelectedVideoDurationMillis int64
	ResourceCount               int32
}

func (p *Project) Delete(now time.Time) {
	p.DeletedAt = &now
	p.UpdatedAt = now
}

type NewInput struct {
	ID                                      string
	TenantID                                string
	WorkspaceID                             *string
	Name                                    string
	CreatedBy                               string
	MemberIDs                               []string
	CoverImageAssetID, CoverImageRevisionID string
	Now                                     time.Time
}

func New(input NewInput) (Project, error) {
	if err := validateName(input.Name); err != nil {
		return Project{}, err
	}
	members, err := normalizeMembers(append(append([]string(nil), input.MemberIDs...), input.CreatedBy))
	if err != nil {
		return Project{}, err
	}
	if !validCoverReference(input.CoverImageAssetID, input.CoverImageRevisionID) {
		return Project{}, ErrInvalidCoverImageReference
	}

	return Project{
		ID:                input.ID,
		TenantID:          input.TenantID,
		WorkspaceID:       cloneString(input.WorkspaceID),
		Name:              input.Name,
		CreatedBy:         input.CreatedBy,
		MemberIDs:         members,
		CoverImageAssetID: input.CoverImageAssetID, CoverImageRevisionID: input.CoverImageRevisionID,
		CreatedAt: input.Now,
		UpdatedAt: input.Now,
	}, nil
}

func (p *Project) Update(name string, memberIDs []string, coverImageAssetID, coverImageRevisionID *string, now time.Time) error {
	if err := validateName(name); err != nil {
		return err
	}
	members, err := normalizeMembers(append(append([]string(nil), memberIDs...), p.CreatedBy))
	if err != nil {
		return err
	}
	if (coverImageAssetID == nil) != (coverImageRevisionID == nil) {
		return ErrInvalidCoverImageReference
	}

	p.Name = name
	p.MemberIDs = members
	if coverImageAssetID != nil {
		if !validCoverReference(*coverImageAssetID, *coverImageRevisionID) {
			return ErrInvalidCoverImageReference
		}
		if p.CoverImageAssetID != *coverImageAssetID || p.CoverImageRevisionID != *coverImageRevisionID {
			p.CoverImageSHA256 = ""
			p.CoverImageContentType = ""
			p.CoverImageSizeBytes = 0
		}
		p.CoverImageAssetID, p.CoverImageRevisionID = *coverImageAssetID, *coverImageRevisionID
	}
	p.UpdatedAt = now
	return nil
}

func (p *Project) UpdateByMember(coverImageAssetID, coverImageRevisionID *string, now time.Time) error {
	if coverImageAssetID == nil && coverImageRevisionID == nil {
		return nil
	}
	if coverImageAssetID == nil || coverImageRevisionID == nil || !validCoverReference(*coverImageAssetID, *coverImageRevisionID) {
		return ErrInvalidCoverImageReference
	}
	if p.CoverImageAssetID != *coverImageAssetID || p.CoverImageRevisionID != *coverImageRevisionID {
		p.CoverImageSHA256 = ""
		p.CoverImageContentType = ""
		p.CoverImageSizeBytes = 0
	}
	p.CoverImageAssetID, p.CoverImageRevisionID = *coverImageAssetID, *coverImageRevisionID
	p.UpdatedAt = now
	return nil
}

func validCoverReference(assetID, revisionID string) bool {
	return assetID == "" && revisionID == "" || assetID != "" && revisionID != ""
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

func normalizeMembers(memberIDs []string) ([]string, error) {
	seen := make(map[string]struct{}, len(memberIDs))
	members := make([]string, 0, len(memberIDs))
	for _, memberID := range memberIDs {
		memberID = strings.TrimSpace(memberID)
		if memberID == "" {
			continue
		}
		if _, ok := seen[memberID]; ok {
			continue
		}
		seen[memberID] = struct{}{}
		members = append(members, memberID)
	}
	if len(members) == 0 {
		return nil, ErrMembersRequired
	}
	return members, nil
}

func cloneString(value *string) *string {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}
