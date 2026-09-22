package project

import (
	"errors"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

var (
	ErrInvalidName           = errors.New("invalid project name")
	ErrInvalidCoverImagePath = errors.New("invalid project cover image path")
	ErrMembersRequired       = errors.New("project members required")
)

type Project struct {
	ID                          string
	TenantID                    string
	WorkspaceID                 *string
	Name                        string
	CreatedBy                   string
	CoverImagePath              *string
	CoverImageID                string
	CoverImageSHA256            string
	CoverImageSizeBytes         int64
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
	ID             string
	TenantID       string
	WorkspaceID    *string
	Name           string
	CreatedBy      string
	MemberIDs      []string
	CoverImagePath *string
	Now            time.Time
}

func New(input NewInput) (Project, error) {
	if err := validateName(input.Name); err != nil {
		return Project{}, err
	}
	members, err := normalizeMembers(append(append([]string(nil), input.MemberIDs...), input.CreatedBy))
	if err != nil {
		return Project{}, err
	}
	var coverImagePath *string
	if input.CoverImagePath != nil {
		coverImagePath, err = normalizeCoverImagePath(*input.CoverImagePath)
		if err != nil {
			return Project{}, err
		}
	}

	return Project{
		ID:             input.ID,
		TenantID:       input.TenantID,
		WorkspaceID:    cloneString(input.WorkspaceID),
		Name:           input.Name,
		CreatedBy:      input.CreatedBy,
		MemberIDs:      members,
		CoverImagePath: coverImagePath,
		CreatedAt:      input.Now,
		UpdatedAt:      input.Now,
	}, nil
}

func (p *Project) Update(name string, memberIDs []string, coverImagePath *string, now time.Time) error {
	if err := validateName(name); err != nil {
		return err
	}
	members, err := normalizeMembers(append(append([]string(nil), memberIDs...), p.CreatedBy))
	if err != nil {
		return err
	}
	var normalizedCoverImagePath *string
	if coverImagePath != nil {
		normalizedCoverImagePath, err = normalizeCoverImagePath(*coverImagePath)
		if err != nil {
			return err
		}
	}

	p.Name = name
	p.MemberIDs = members
	if coverImagePath != nil {
		if !equalStringPointers(p.CoverImagePath, normalizedCoverImagePath) {
			p.CoverImageID = ""
			p.CoverImageSHA256 = ""
			p.CoverImageSizeBytes = 0
		}
		p.CoverImagePath = normalizedCoverImagePath
	}
	p.UpdatedAt = now
	return nil
}

func (p *Project) UpdateByMember(coverImagePath *string, now time.Time) error {
	if coverImagePath == nil {
		return nil
	}
	normalizedCoverImagePath, err := normalizeCoverImagePath(*coverImagePath)
	if err != nil {
		return err
	}
	if !equalStringPointers(p.CoverImagePath, normalizedCoverImagePath) {
		p.CoverImageID = ""
		p.CoverImageSHA256 = ""
		p.CoverImageSizeBytes = 0
	}
	p.CoverImagePath = normalizedCoverImagePath
	p.UpdatedAt = now
	return nil
}

func normalizeCoverImagePath(value string) (*string, error) {
	if utf8.RuneCountInString(value) > 128 {
		return nil, ErrInvalidCoverImagePath
	}
	if value == "" {
		return nil, nil
	}
	return cloneString(&value), nil
}

func equalStringPointers(left, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
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
