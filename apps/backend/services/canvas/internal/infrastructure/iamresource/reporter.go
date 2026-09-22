package iamresource

import (
	"context"

	applicationscopecleanup "github.com/example/monorepo/canvas/internal/application/scopecleanup"
)

type messageProducer interface {
	Publish(context.Context, string, any) error
}

type Reporter struct {
	producer messageProducer
	topic    string
}

func NewReporter(producer messageProducer, topic string) *Reporter {
	return &Reporter{producer: producer, topic: topic}
}

type resourceMessage struct {
	Source string               `json:"Source"`
	Items  []tenantResourceItem `json:"Items"`
}

type tenantResourceItem struct {
	TenantID      string `json:"TenantID"`
	WorkspaceID   string `json:"WorkspaceID"`
	ResourceID    string `json:"ResourceID"`
	Operation     string `json:"Operation"`
	OperatorID    string `json:"OperatorID"`
	ResourceType  string `json:"ResourceType"`
	ResourceValue int64  `json:"ResourceValue"`
	ProductCode   string `json:"ProductCode"`
}

func (r *Reporter) ReportTenantClear(ctx context.Context, tenantID, operatorID string) error {
	return r.report(ctx, tenantResourceItem{
		TenantID: tenantID, ResourceID: tenantID, Operation: "Clear",
		OperatorID: operatorID, ResourceType: "Tenant",
	})
}

func (r *Reporter) ReportWorkspaceClear(ctx context.Context, tenantID, workspaceID, operatorID string) error {
	return r.report(ctx, tenantResourceItem{
		TenantID: tenantID, ResourceID: workspaceID, Operation: "Clear",
		OperatorID: operatorID, ResourceType: "Workspace",
	})
}

func (r *Reporter) report(ctx context.Context, item tenantResourceItem) error {
	// IAM keys Clear receipts by ProjectToMqSource(project), which preserves
	// "AgentFrame". "App" identifies HiAgent and cannot acknowledge our cleanup.
	return r.producer.Publish(ctx, r.topic, resourceMessage{Source: "AgentFrame", Items: []tenantResourceItem{item}})
}

var _ applicationscopecleanup.ClearReporter = (*Reporter)(nil)
