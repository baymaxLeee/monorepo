package agent

import (
	"context"
	"errors"
)

const (
	TenantAgentDeleteJobKind = "hibot.tenant-agent.delete.v1"
	ProductCodeAgentFrame    = "agentframe"
	SystemWorkspaceID        = "workspace-system"
	SystemUserID             = "system"
)

var ErrTenantAgentNotFound = errors.New("tenant Hibot Agent not found")

type TenantAgent struct {
	TenantID        string
	ProductCode     string
	WorkspaceID     string
	AgentID         string
	CreatedByUserID string
	BindingDigest   string
	PromptVersion   string
}

type TenantAgentStore interface {
	GetTenantAgent(context.Context, string, string) (TenantAgent, error)
	UpsertTenantAgent(context.Context, TenantAgent) error
	DeleteTenantAgent(context.Context, string, string, string) error
}

type TransactionManager interface {
	WithinTransaction(context.Context, func(context.Context) error) error
}

type DeletionQueue interface {
	Enqueue(context.Context, string, string, string, any) error
}

type TenantAgentDeletePayload struct {
	TenantID    string `json:"tenant_id"`
	ProductCode string `json:"product_code"`
	WorkspaceID string `json:"workspace_id"`
	AgentID     string `json:"agent_id"`
	UserID      string `json:"user_id"`
	OperatorID  string `json:"operator_id"`
}

type TenantAgentCleaner struct {
	store        TenantAgentStore
	transactions TransactionManager
	deletions    DeletionQueue
}

func NewTenantAgentCleaner(
	store TenantAgentStore,
	transactions TransactionManager,
	deletions DeletionQueue,
) *TenantAgentCleaner {
	return &TenantAgentCleaner{store: store, transactions: transactions, deletions: deletions}
}

func (c *TenantAgentCleaner) DeleteByTenant(ctx context.Context, tenantID, operatorID string) error {
	return c.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		agent, err := c.store.GetTenantAgent(txCtx, tenantID, ProductCodeAgentFrame)
		if errors.Is(err, ErrTenantAgentNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		payload := TenantAgentDeletePayload{
			TenantID: tenantID, ProductCode: ProductCodeAgentFrame,
			WorkspaceID: SystemWorkspaceID, AgentID: agent.AgentID,
			UserID: SystemUserID, OperatorID: operatorID,
		}
		if err := c.deletions.Enqueue(txCtx, tenantID, TenantAgentDeleteJobKind, agent.AgentID, payload); err != nil {
			return err
		}
		return c.store.DeleteTenantAgent(txCtx, tenantID, ProductCodeAgentFrame, agent.AgentID)
	})
}

// 公共 Agent 属于租户，不属于业务工作空间。工作空间回收不能删除它。
func (*TenantAgentCleaner) DeleteByWorkspace(context.Context, string, string, string) error {
	return nil
}
