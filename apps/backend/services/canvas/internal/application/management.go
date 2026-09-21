package application

import (
	"context"
	"strings"

	c "github.com/example/monorepo/canvas/internal/application/contracts"
	adminclient "github.com/example/monorepo/canvas/internal/infrastructure/admin"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type ProjectMemberDirectory interface {
	ActiveMemberIDs(context.Context, string, string) ([]string, error)
}

type ProjectProviderDirectory interface {
	List(context.Context, string, string) ([]adminclient.Provider, error)
}

const maximumProjectUsageMicros int64 = 1_000_000_000 * 1_000_000

type projectUsagePolicy struct {
	ProjectID            string `gorm:"primaryKey"`
	TenantID             string
	WorkspaceID          string
	UsageLimitMicros     *int64
	UsedAmountMicros     int64
	ReservedAmountMicros int64
	Currency             string
}

func (projectUsagePolicy) TableName() string { return "project_usage_policies" }

func (s *Service) ProjectManagement(ctx context.Context, actor Actor, projectID string) (c.ProjectManagement, error) {
	if err := requireProjectAdmin(actor); err != nil {
		return c.ProjectManagement{}, err
	}
	db := s.DB.WithContext(ctx)
	project, err := access(db, actor, projectID, false)
	if err != nil {
		return c.ProjectManagement{}, err
	}
	var members []p.Member
	if err := db.Where("project_id = ?", project.ID).Order("user_id").Find(&members).Error; err != nil {
		return c.ProjectManagement{}, err
	}
	out := c.ProjectManagement{
		Project: projectDTO(project), Members: []c.Member{},
		CanManage: actor.WorkspaceRole == "workspace_admin",
	}
	for _, member := range members {
		out.Members = append(out.Members, c.Member{UserID: member.UserID, Role: member.Role})
	}
	var policy projectUsagePolicy
	if err := db.Where(
		"project_id = ? AND tenant_id = ? AND workspace_id = ?", projectID, actor.TenantID, actor.WorkspaceID,
	).Take(&policy).Error; err != nil && err != gorm.ErrRecordNotFound {
		return c.ProjectManagement{}, err
	}
	out.UsageLimitMicros = policy.UsageLimitMicros
	out.UsedAmountMicros = policy.UsedAmountMicros
	out.Currency = policy.Currency
	return out, nil
}

func requireProjectAdmin(actor Actor) error {
	if actor.WorkspaceRole != "workspace_admin" {
		return &Error{Status: 403, Code: "forbidden", Message: "仅工作空间管理员可管理项目"}
	}
	return nil
}

func (s *Service) validateProjectMembers(ctx context.Context, actor Actor, requested []string, authorization string) ([]string, error) {
	if s.MemberDirectory == nil || authorization == "" {
		return nil, &Error{Status: 503, Code: "directory_unavailable", Message: "无法验证工作空间成员"}
	}
	ids, err := s.MemberDirectory.ActiveMemberIDs(ctx, actor.WorkspaceID, authorization)
	if err != nil {
		return nil, &Error{Status: 503, Code: "directory_unavailable", Message: "无法验证工作空间成员"}
	}
	active := make(map[string]bool, len(ids))
	for _, id := range ids {
		active[id] = true
	}
	normalized := make([]string, 0, len(requested))
	seen := make(map[string]bool, len(requested))
	for _, id := range requested {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		if !active[id] {
			return nil, Invalid("仅可添加当前工作空间的有效成员")
		}
		seen[id] = true
		normalized = append(normalized, id)
	}
	return normalized, nil
}

func (s *Service) UpdateProjectMembers(ctx context.Context, actor Actor, projectID string, in c.UpdateProjectMembers, authorization string) (c.ProjectManagement, error) {
	if err := requireProjectAdmin(actor); err != nil {
		return c.ProjectManagement{}, err
	}
	project, err := manageProject(s.DB.WithContext(ctx), actor, projectID)
	if err != nil {
		return c.ProjectManagement{}, err
	}
	if _, err := s.validateProjectMembers(ctx, actor, memberIDsExcept(in.Members, project.CreatedBy), authorization); err != nil {
		return c.ProjectManagement{}, err
	}
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		project, err := manageProject(tx, actor, projectID)
		if err != nil {
			return err
		}
		if project.Revision != in.ExpectedRevision {
			return Conflict()
		}
		members := []p.Member{{ProjectID: projectID, UserID: project.CreatedBy, Role: "owner"}}
		seen := map[string]bool{project.CreatedBy: true}
		for _, member := range in.Members {
			if member.UserID == project.CreatedBy {
				continue
			}
			if strings.TrimSpace(member.UserID) != member.UserID || member.UserID == "" || len(member.UserID) > 160 {
				return Invalid("invalid member user id")
			}
			if member.Role != "editor" && member.Role != "viewer" {
				return Invalid("member role must be editor or viewer")
			}
			if seen[member.UserID] {
				return Invalid("duplicate project member")
			}
			seen[member.UserID] = true
			members = append(members, p.Member{ProjectID: projectID, UserID: member.UserID, Role: member.Role})
		}
		if err := tx.Where("project_id = ?", projectID).Delete(&p.Member{}).Error; err != nil {
			return err
		}
		if err := tx.Create(&members).Error; err != nil {
			return err
		}
		return tx.Model(&project).Update("revision", project.Revision+1).Error
	})
	if err != nil {
		return c.ProjectManagement{}, err
	}
	return s.ProjectManagement(ctx, actor, projectID)
}

func memberIDs(members []c.Member) []string {
	ids := make([]string, 0, len(members))
	for _, member := range members {
		ids = append(ids, member.UserID)
	}
	return ids
}

func memberIDsExcept(members []c.Member, excluded string) []string {
	ids := make([]string, 0, len(members))
	for _, member := range members {
		if member.UserID != excluded {
			ids = append(ids, member.UserID)
		}
	}
	return ids
}

func (s *Service) UpdateProjectUsageLimit(ctx context.Context, actor Actor, projectID string, in c.UpdateProjectUsageLimit) (c.ProjectManagement, error) {
	if err := requireProjectAdmin(actor); err != nil {
		return c.ProjectManagement{}, err
	}
	if in.UsageLimitMicros != nil && (*in.UsageLimitMicros <= 0 || *in.UsageLimitMicros > maximumProjectUsageMicros) {
		return c.ProjectManagement{}, Invalid("项目额度必须大于 0")
	}
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		project, err := manageProject(tx, actor, projectID)
		if err != nil {
			return err
		}
		if project.Revision != in.ExpectedRevision {
			return Conflict()
		}
		var policy projectUsagePolicy
		err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("project_id = ?", projectID).Take(&policy).Error
		if err == gorm.ErrRecordNotFound {
			policy = projectUsagePolicy{ProjectID: projectID, TenantID: actor.TenantID, WorkspaceID: actor.WorkspaceID, Currency: "CNY"}
		} else if err != nil {
			return err
		}
		if in.UsageLimitMicros != nil && *in.UsageLimitMicros < policy.UsedAmountMicros+policy.ReservedAmountMicros {
			return Invalid("项目额度不能低于已用金额")
		}
		policy.UsageLimitMicros = in.UsageLimitMicros
		if err := tx.Save(&policy).Error; err != nil {
			return err
		}
		return tx.Model(&project).Update("revision", project.Revision+1).Error
	})
	if err != nil {
		return c.ProjectManagement{}, err
	}
	return s.ProjectManagement(ctx, actor, projectID)
}

type generationAdmission struct {
	AmountMicros int64
	Metadata     p.GenerationUsageMetadata
}

func (s *Service) admitGeneration(ctx context.Context, tx *gorm.DB, actor Actor, projectID, providerID, providerKind string, durationSeconds int32) (generationAdmission, error) {
	if s.ProviderDirectory == nil {
		return generationAdmission{}, &Error{Status: 503, Code: "provider_directory_unavailable", Message: "模型目录不可用"}
	}
	providers, err := s.ProviderDirectory.List(ctx, actor.TenantID, actor.WorkspaceID)
	if err != nil {
		return generationAdmission{}, &Error{Status: 503, Code: "provider_directory_unavailable", Message: "模型目录不可用"}
	}
	var provider *adminclient.Provider
	for index := range providers {
		if providers[index].ID == providerID && providers[index].IsEnabled {
			provider = &providers[index]
			break
		}
	}
	if provider == nil {
		return generationAdmission{}, &Error{Status: 403, Code: "model_unavailable", Message: "该模型不可用"}
	}
	if provider.ProviderKind != providerKind {
		return generationAdmission{}, &Error{Status: 400, Code: "model_kind_mismatch", Message: "模型类型与生成任务不匹配"}
	}
	var policy projectUsagePolicy
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("project_id = ? AND tenant_id = ? AND workspace_id = ?", projectID, actor.TenantID, actor.WorkspaceID).Take(&policy).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return generationAdmission{}, &Error{Status: 500, Code: "project_usage_policy_missing", Message: "项目额度策略缺失"}
		}
		return generationAdmission{}, err
	}
	reserved := int64(0)
	estimateKnown := provider.Pricing != nil && ((providerKind == "image" && provider.Pricing.Unit == "generated_item") || (providerKind == "video" && provider.Pricing.Unit == "generated_second" && durationSeconds > 0))
	if policy.UsageLimitMicros != nil && !estimateKnown {
		return generationAdmission{}, &Error{Status: 400, Code: "model_pricing_unavailable", Message: "该项目设置了金额额度，需使用已配置单价且时长确定的模型"}
	}
	if estimateKnown {
		reserved = provider.Pricing.UnitPriceMicros
		if provider.Pricing.Unit == "generated_second" {
			reserved *= int64(durationSeconds)
		}
	}
	if policy.UsageLimitMicros != nil && policy.UsedAmountMicros+policy.ReservedAmountMicros+reserved > *policy.UsageLimitMicros {
		return generationAdmission{}, &Error{Status: 403, Code: "project_usage_exceeded", Message: "项目生成额度不足"}
	}
	if reserved > 0 {
		if policy.ProjectID != "" && provider.Pricing.Currency != policy.Currency {
			return generationAdmission{}, &Error{Status: 400, Code: "provider_currency_mismatch", Message: "模型计费币种与项目额度币种不一致"}
		}
		result := tx.Model(&projectUsagePolicy{}).Where("project_id = ? AND tenant_id = ? AND workspace_id = ?", projectID, actor.TenantID, actor.WorkspaceID).UpdateColumn(
			"reserved_amount_micros", gorm.Expr("reserved_amount_micros + ?", reserved),
		)
		if result.Error != nil {
			return generationAdmission{}, result.Error
		}
		if result.RowsAffected != 1 {
			return generationAdmission{}, &Error{Status: 500, Code: "project_usage_policy_missing", Message: "项目额度策略缺失"}
		}
	}
	metadata := p.GenerationUsageMetadata{TenantID: actor.TenantID, WorkspaceID: actor.WorkspaceID, ProjectID: projectID, ModelName: provider.Name, ModelID: provider.Model}
	if estimateKnown {
		metadata.Currency = provider.Pricing.Currency
		metadata.EstimateKnown = true
	}
	return generationAdmission{AmountMicros: reserved, Metadata: metadata}, nil
}
