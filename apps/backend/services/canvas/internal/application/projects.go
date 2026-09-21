package application

import (
	"context"
	"github.com/example/monorepo/canvas/internal/application/contracts"
	"github.com/example/monorepo/canvas/internal/infrastructure/executor"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	"github.com/example/monorepo/canvas/internal/infrastructure/storage"
	projectusage "github.com/example/monorepo/canvas/internal/server/application/projectusage"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"strings"
	"unicode"
	"unicode/utf8"
)

type Service struct {
	Storage           *storage.Client
	DB                *gorm.DB
	Executor          *executor.Client
	MemberDirectory   ProjectMemberDirectory
	ProviderDirectory ProjectProviderDirectory
	UsageExporter     *projectusage.Exporter
	PublicGatewayURL  string
}

func newID() string {
	id, err := uuid.NewV7()
	if err != nil {
		panic(err)
	}
	return strings.ReplaceAll(id.String(), "-", "")
}

func validName(name string) bool {
	runes := []rune(name)
	return utf8.ValidString(name) && len(runes) > 0 && len(runes) <= 20 &&
		runes[0] != '-' && runes[0] != '_' && !unicode.IsSpace(runes[0]) &&
		runes[len(runes)-1] != '-' && runes[len(runes)-1] != '_' && !unicode.IsSpace(runes[len(runes)-1])
}
func projectDTO(v p.Project) contracts.Project {
	cover := ""
	if v.CoverAssetID != "" {
		cover = "/api/canvas-server/projects/" + v.ID + "/cover/content"
	}
	return contracts.Project{CreatedAt: isoTime(v.CreatedAt), UpdatedAt: isoTime(v.UpdatedAt), ID: v.ID, Name: v.Name, Description: v.Description, CoverImagePath: cover, CreatedBy: v.CreatedBy, Revision: v.Revision}
}
func boardDTO(v p.Board) contracts.Board {
	cover := ""
	if v.CoverAssetID != "" {
		cover = "/api/canvas-server/canvases/" + v.ID + "/cover/content"
	}
	return contracts.Board{CreatedAt: isoTime(v.CreatedAt), UpdatedAt: isoTime(v.UpdatedAt), ID: v.ID, ProjectID: v.ProjectID, Name: v.Name, CoverImagePath: cover, CreatedBy: v.CreatedBy, DefaultView: v.DefaultView, Revision: v.Revision}
}
func access(db *gorm.DB, actor Actor, id string, write bool) (p.Project, error) {
	var project p.Project
	if err := db.Clauses(clause.Locking{Strength: "SHARE"}).Where("id = ? AND tenant_id = ? AND workspace_id = ?", id, actor.TenantID, actor.WorkspaceID).First(&project).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return project, NotFound()
		}
		return project, err
	}
	var member p.Member
	err := db.Where("project_id = ? AND user_id = ?", id, actor.UserID).First(&member).Error
	if err != nil && err != gorm.ErrRecordNotFound {
		return project, err
	}
	if project.CreatedBy == actor.UserID || actor.WorkspaceRole == "workspace_admin" {
		return project, nil
	}
	if err != nil || (write && member.Role == "viewer") {
		return project, NotFound()
	}
	return project, nil
}
func (s *Service) ListProjects(ctx context.Context, a Actor) (contracts.ProjectList, error) {
	db := s.DB.WithContext(ctx)
	var rows []p.Project
	q := db.Where("tenant_id = ? AND workspace_id = ?", a.TenantID, a.WorkspaceID)
	if a.WorkspaceRole != "workspace_admin" {
		q = q.Where("created_by = ? OR id IN (SELECT project_id FROM project_members WHERE user_id = ?)", a.UserID, a.UserID)
	}
	if err := q.Order("updated_at DESC, id").Find(&rows).Error; err != nil {
		return contracts.ProjectList{}, err
	}
	result := contracts.ProjectList{Items: []contracts.Project{}}
	for _, v := range rows {
		result.Items = append(result.Items, projectDTO(v))
	}
	return result, nil
}
func (s *Service) CreateProject(ctx context.Context, a Actor, in contracts.CreateProject, authorization string) (contracts.Project, error) {
	if err := requireProjectAdmin(a); err != nil {
		return contracts.Project{}, err
	}
	if !validName(in.Name) || len(in.Description) > 20000 {
		return contracts.Project{}, Invalid("invalid project name or description")
	}
	if in.UsageLimitMicros != nil && *in.UsageLimitMicros <= 0 {
		return contracts.Project{}, Invalid("项目额度必须大于 0")
	}
	if in.UsageLimitMicros != nil && *in.UsageLimitMicros > maximumProjectUsageMicros {
		return contracts.Project{}, Invalid("项目额度不能超过 10 亿元")
	}
	memberIDs, err := s.validateProjectMembers(ctx, a, in.MemberUserIDs, authorization)
	if err != nil {
		return contracts.Project{}, err
	}
	v := p.Project{ID: newID(), TenantID: a.TenantID, WorkspaceID: a.WorkspaceID, Name: in.Name, Description: in.Description, CreatedBy: a.UserID, Revision: 1}
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&v).Error; err != nil {
			return err
		}
		members := []p.Member{{ProjectID: v.ID, UserID: a.UserID, Role: "owner"}}
		seen := map[string]bool{a.UserID: true}
		for _, userID := range memberIDs {
			if userID == "" || seen[userID] {
				continue
			}
			seen[userID] = true
			members = append(members, p.Member{ProjectID: v.ID, UserID: userID, Role: "editor"})
		}
		if err := tx.Create(&members).Error; err != nil {
			return err
		}
		return tx.Create(&projectUsagePolicy{ProjectID: v.ID, TenantID: a.TenantID, WorkspaceID: a.WorkspaceID, Currency: "CNY", UsageLimitMicros: in.UsageLimitMicros}).Error
	})
	if uniqueViolation(err, "projects_scope_name") {
		err = ConflictMessage("project_name_conflict", "同一工作空间内项目名称不能重复")
	}
	return projectDTO(v), err
}
func (s *Service) ListBoards(ctx context.Context, a Actor, projectID string, createdByMe bool) (contracts.BoardList, error) {
	db := s.DB.WithContext(ctx)
	if _, err := access(db, a, projectID, false); err != nil {
		return contracts.BoardList{}, err
	}
	var rows []p.Board
	query := db.Where("project_id = ?", projectID)
	if createdByMe {
		query = query.Where("created_by = ?", a.UserID)
	}
	if err := query.Order("created_at, id").Find(&rows).Error; err != nil {
		return contracts.BoardList{}, err
	}
	result := contracts.BoardList{Items: []contracts.Board{}}
	for _, v := range rows {
		result.Items = append(result.Items, boardDTO(v))
	}
	return result, nil
}
func (s *Service) CreateBoard(ctx context.Context, a Actor, projectID string, in contracts.CreateBoard) (contracts.Board, error) {
	if !validName(in.Name) {
		return contracts.Board{}, Invalid("invalid canvas name")
	}
	v := p.Board{ID: newID(), ProjectID: projectID, Name: in.Name, CreatedBy: a.UserID, DefaultView: 2, Revision: 1}
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := access(tx, a, projectID, true); err != nil {
			return err
		}
		return tx.Create(&v).Error
	})
	return boardDTO(v), err
}
