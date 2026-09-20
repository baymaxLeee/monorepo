package application

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"github.com/example/monorepo/canvas/internal/application/contracts"
	"github.com/example/monorepo/canvas/internal/infrastructure/executor"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	"github.com/example/monorepo/canvas/internal/infrastructure/storage"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"strings"
	"unicode/utf8"
)

type Service struct {
	Storage  *storage.Client
	DB       *gorm.DB
	Executor *executor.Client
}

func newID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func validName(name string) bool {
	return strings.TrimSpace(name) == name && utf8.RuneCountInString(name) > 0 && utf8.RuneCountInString(name) <= 50
}
func projectDTO(v p.Project) contracts.Project {
	return contracts.Project{CreatedAt: isoTime(v.CreatedAt), UpdatedAt: isoTime(v.UpdatedAt), ID: v.ID, Name: v.Name, Description: v.Description, CreatedBy: v.CreatedBy, Revision: v.Revision}
}
func boardDTO(v p.Board) contracts.Board {
	return contracts.Board{CreatedAt: isoTime(v.CreatedAt), UpdatedAt: isoTime(v.UpdatedAt), ID: v.ID, ProjectID: v.ProjectID, Name: v.Name, Revision: v.Revision}
}
func access(db *gorm.DB, actor Actor, id string, write bool) (p.Project, error) {
	var project p.Project
	if err := db.Clauses(clause.Locking{Strength: "SHARE"}).Where("id = ? AND org_id = ?", id, actor.OrgID).First(&project).Error; err != nil {
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
	if project.CreatedBy == actor.UserID || actor.OrgRole == "org_admin" {
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
	q := db.Where("org_id = ?", a.OrgID)
	if a.OrgRole != "org_admin" {
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
func (s *Service) CreateProject(ctx context.Context, a Actor, in contracts.CreateProject) (contracts.Project, error) {
	if !validName(in.Name) || len(in.Description) > 20000 {
		return contracts.Project{}, Invalid("invalid project name or description")
	}
	v := p.Project{ID: newID(), OrgID: a.OrgID, Name: in.Name, Description: in.Description, CreatedBy: a.UserID, Revision: 1}
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&v).Error; err != nil {
			return err
		}
		return tx.Create(&p.Member{ProjectID: v.ID, UserID: a.UserID, Role: "owner"}).Error
	})
	return projectDTO(v), err
}
func (s *Service) ListBoards(ctx context.Context, a Actor, projectID string) (contracts.BoardList, error) {
	db := s.DB.WithContext(ctx)
	if _, err := access(db, a, projectID, false); err != nil {
		return contracts.BoardList{}, err
	}
	var rows []p.Board
	if err := db.Where("project_id = ?", projectID).Order("created_at, id").Find(&rows).Error; err != nil {
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
	v := p.Board{ID: newID(), ProjectID: projectID, Name: in.Name, Revision: 1}
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := access(tx, a, projectID, true); err != nil {
			return err
		}
		return tx.Create(&v).Error
	})
	return boardDTO(v), err
}
