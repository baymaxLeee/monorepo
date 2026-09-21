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

type projectSummaryRow struct {
	p.Project                   `gorm:"embedded"`
	CanvasCount                 int32  `gorm:"column:canvas_count"`
	SelectedVideoDurationMillis int64  `gorm:"column:selected_video_duration_millis"`
	ResourceCount               int32  `gorm:"column:resource_count"`
	CoverArtifactID             string `gorm:"column:cover_artifact_id"`
	CoverMimeType               string `gorm:"column:cover_mime_type"`
}

func projectSummaryDTO(v projectSummaryRow, coverURL string) contracts.ProjectSummary {
	project := projectDTO(v.Project)
	project.CoverImagePath = coverURL
	return contracts.ProjectSummary{
		CreatedAt: project.CreatedAt, UpdatedAt: project.UpdatedAt, ID: project.ID, Name: project.Name,
		Description: project.Description, CoverImagePath: project.CoverImagePath, CreatedBy: project.CreatedBy,
		Revision: project.Revision,
		Stats: contracts.ProjectStats{
			CanvasCount: v.CanvasCount, SelectedVideoDurationMillis: v.SelectedVideoDurationMillis,
			ResourceCount: v.ResourceCount,
		},
	}
}

type boardSummaryRow struct {
	p.Board         `gorm:"embedded"`
	CoverArtifactID string `gorm:"column:cover_artifact_id"`
	CoverMimeType   string `gorm:"column:cover_mime_type"`
}

func boardDTO(v p.Board) contracts.Board {
	cover := ""
	if v.CoverAssetID != "" {
		cover = "/api/canvas-server/canvases/" + v.ID + "/cover/content"
	}
	return contracts.Board{CreatedAt: isoTime(v.CreatedAt), UpdatedAt: isoTime(v.UpdatedAt), ID: v.ID, ProjectID: v.ProjectID, Name: v.Name, CoverImagePath: cover, CreatedBy: v.CreatedBy, DefaultView: v.DefaultView, Revision: v.Revision}
}

func (s *Service) signedCoverURL(ctx context.Context, actor Actor, projectID, assetID string) string {
	if assetID == "" {
		return ""
	}
	var asset p.Asset
	if err := s.DB.WithContext(ctx).Where(
		"id = ? AND tenant_id = ? AND workspace_id = ? AND project_id = ? AND deleted_at IS NULL",
		assetID, actor.TenantID, actor.WorkspaceID, projectID,
	).First(&asset).Error; err != nil {
		return ""
	}
	namespace := storage.Scope(actor.TenantID, actor.WorkspaceID, projectID)
	urls, err := s.Storage.BatchPublicURLs(ctx, []storage.Artifact{{Namespace: namespace, ID: asset.ArtifactID, ContentType: asset.MimeType}})
	if err != nil {
		return ""
	}
	return urls[storage.ArtifactLookupKey(namespace, asset.ArtifactID)].URL
}

func (s *Service) projectDTOWithCover(ctx context.Context, actor Actor, value p.Project) contracts.Project {
	item := projectDTO(value)
	item.CoverImagePath = s.signedCoverURL(ctx, actor, value.ID, value.CoverAssetID)
	return item
}

func (s *Service) boardDTOWithCover(ctx context.Context, actor Actor, value p.Board) contracts.Board {
	item := boardDTO(value)
	item.CoverImagePath = s.signedCoverURL(ctx, actor, value.ProjectID, value.CoverAssetID)
	return item
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
	var rows []projectSummaryRow
	q := db.Model(&p.Project{}).Select(`projects.*,
		COALESCE(canvas_stats.canvas_count, 0) AS canvas_count,
		COALESCE(canvas_stats.selected_video_duration_millis, 0) AS selected_video_duration_millis,
		COALESCE(resource_stats.resource_count, 0) AS resource_count,
		COALESCE(cover_assets.artifact_id, '') AS cover_artifact_id,
		COALESCE(cover_assets.mime_type, '') AS cover_mime_type`).Joins(`LEFT JOIN (
		SELECT canvases.project_id,
			COUNT(DISTINCT canvases.id) AS canvas_count,
			COALESCE(SUM(COALESCE((canvas_nodes.generation_config ->> 'duration_seconds')::bigint, 0)), 0) * 1000 AS selected_video_duration_millis
		FROM canvases
		LEFT JOIN canvas_nodes ON canvas_nodes.canvas_id = canvases.id AND canvas_nodes.deleted_at IS NULL
		WHERE canvases.deleted_at IS NULL
		GROUP BY canvases.project_id
	) AS canvas_stats ON canvas_stats.project_id = projects.id`).Joins(`LEFT JOIN (
		SELECT project_id, COUNT(*) AS resource_count
		FROM resources
		WHERE deleted_at IS NULL
		GROUP BY project_id
	) AS resource_stats ON resource_stats.project_id = projects.id`).Joins(
		"LEFT JOIN assets AS cover_assets ON cover_assets.id = projects.cover_asset_id AND cover_assets.deleted_at IS NULL",
	).Where(
		"projects.tenant_id = ? AND projects.workspace_id = ?", a.TenantID, a.WorkspaceID,
	)
	if a.WorkspaceRole != "workspace_admin" {
		q = q.Where("projects.created_by = ? OR projects.id IN (SELECT project_id FROM project_members WHERE user_id = ?)", a.UserID, a.UserID)
	}
	if err := q.Order("projects.updated_at DESC, projects.id").Scan(&rows).Error; err != nil {
		return contracts.ProjectList{}, err
	}
	artifacts := make([]storage.Artifact, 0, len(rows))
	for _, row := range rows {
		if row.CoverArtifactID != "" {
			artifacts = append(artifacts, storage.Artifact{Namespace: storage.Scope(row.TenantID, row.WorkspaceID, row.ID), ID: row.CoverArtifactID, ContentType: row.CoverMimeType})
		}
	}
	urls, _ := s.Storage.BatchPublicURLs(ctx, artifacts)
	result := contracts.ProjectList{Items: []contracts.ProjectSummary{}}
	for _, v := range rows {
		coverURL := ""
		if item, ok := urls[storage.ArtifactLookupKey(storage.Scope(v.TenantID, v.WorkspaceID, v.ID), v.CoverArtifactID)]; ok {
			coverURL = item.URL
		}
		result.Items = append(result.Items, projectSummaryDTO(v, coverURL))
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
	var rows []boardSummaryRow
	query := db.Model(&p.Board{}).Select(`canvases.*,
		COALESCE(cover_assets.artifact_id, '') AS cover_artifact_id,
		COALESCE(cover_assets.mime_type, '') AS cover_mime_type`).Joins(
		"LEFT JOIN assets AS cover_assets ON cover_assets.id = canvases.cover_asset_id AND cover_assets.deleted_at IS NULL",
	).Where("canvases.project_id = ?", projectID)
	if createdByMe {
		query = query.Where("created_by = ?", a.UserID)
	}
	if err := query.Order("canvases.created_at, canvases.id").Find(&rows).Error; err != nil {
		return contracts.BoardList{}, err
	}
	artifacts := make([]storage.Artifact, 0, len(rows))
	namespace := storage.Scope(a.TenantID, a.WorkspaceID, projectID)
	for _, row := range rows {
		if row.CoverArtifactID != "" {
			artifacts = append(artifacts, storage.Artifact{Namespace: namespace, ID: row.CoverArtifactID, ContentType: row.CoverMimeType})
		}
	}
	urls, _ := s.Storage.BatchPublicURLs(ctx, artifacts)
	result := contracts.BoardList{Items: []contracts.Board{}}
	for _, v := range rows {
		item := boardDTO(v.Board)
		if signed, ok := urls[storage.ArtifactLookupKey(namespace, v.CoverArtifactID)]; ok {
			item.CoverImagePath = signed.URL
		} else {
			item.CoverImagePath = ""
		}
		result.Items = append(result.Items, item)
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
