package bootstrap

import (
	"context"
	"errors"
	"time"

	applicationcanvas "github.com/example/monorepo/canvas/internal/application/canvas"
	applicationcanvasarchive "github.com/example/monorepo/canvas/internal/application/canvasarchive"
	applicationdeletion "github.com/example/monorepo/canvas/internal/application/deletion"
	applicationimagegeneration "github.com/example/monorepo/canvas/internal/application/imagegeneration"
	applicationprojectaccess "github.com/example/monorepo/canvas/internal/application/projectaccess"
	applicationquota "github.com/example/monorepo/canvas/internal/application/quota"
	"github.com/example/monorepo/canvas/internal/application/requestcontext"
	applicationresource "github.com/example/monorepo/canvas/internal/application/resource"
	domainimagegeneration "github.com/example/monorepo/canvas/internal/domain/imagegeneration"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	"github.com/google/uuid"
)

type uuidGenerator struct{}

func (uuidGenerator) NewID() (string, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return "", err
	}
	return id.String(), nil
}

type utcClock struct{}

func (utcClock) Now() time.Time { return time.Now().UTC() }

type processRole string

const (
	roleServer processRole = "server"
	roleWorker processRole = "worker"
)

type localAsyncExecutor struct {
	runType domaintask.RunType
	execute func(context.Context, string) error
	fail    func(context.Context, string) error
}

func (executor localAsyncExecutor) RunType() domaintask.RunType { return executor.runType }
func (executor localAsyncExecutor) Execute(ctx context.Context, taskRunID string) error {
	return executor.execute(ctx, taskRunID)
}
func (executor localAsyncExecutor) CommitFailure(ctx context.Context, taskRunID string) error {
	return executor.fail(ctx, taskRunID)
}

type unavailableQuotaLimits struct{}

func (unavailableQuotaLimits) Limit(context.Context, string, applicationquota.ResourceType) (applicationquota.Limit, error) {
	return applicationquota.Limit{}, applicationquota.ErrUnavailable
}

type gatewayProjectPermissions struct{}

func (gatewayProjectPermissions) Permissions(
	ctx context.Context, tenantID string, workspaceID *string, userID string,
) (applicationprojectaccess.Permissions, error) {
	metadata, ok := requestcontext.MetadataFromContext(ctx)
	if !ok || metadata.TenantID != tenantID || metadata.UserID != userID || workspaceID == nil || metadata.WorkspaceID != *workspaceID {
		return applicationprojectaccess.Permissions{}, errors.New("trusted request identity does not match project scope")
	}
	if metadata.WorkspaceRole == "workspace_admin" {
		return applicationprojectaccess.Permissions{Read: true, Update: true}, nil
	}
	return applicationprojectaccess.Permissions{}, nil
}

type archiveCanvasAccess struct {
	canvases interface {
		Validate(context.Context, applicationcanvas.Scope, string, string) error
	}
}

func (access archiveCanvasAccess) Validate(
	ctx context.Context,
	scope applicationcanvasarchive.Scope,
	projectID string,
	canvasID string,
) error {
	return access.canvases.Validate(ctx, applicationcanvas.Scope{
		TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CallerID: scope.CallerID,
	}, projectID, canvasID)
}

const imageTaskCleanupJobKind = "image.task.cleanup.v1"

type resourceGenerationDeletion struct {
	engine interface {
		ReleaseOutputsByTargets(context.Context, applicationimagegeneration.Scope, domainimagegeneration.TargetType, []string, time.Time) error
	}
	runs interface {
		ListRunIDsByTargets(context.Context, applicationimagegeneration.Scope, domainimagegeneration.TargetType, []string) ([]string, error)
	}
	queue *applicationdeletion.Queue
}

func (d resourceGenerationDeletion) DeleteGeneration(ctx context.Context, scope applicationresource.Scope, draftID string, now time.Time) error {
	return d.DeleteTargets(ctx, applicationimagegeneration.Scope{
		TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CallerID: scope.CallerID,
	}, domainimagegeneration.TargetResourceAsset, []string{draftID}, now)
}

func (d resourceGenerationDeletion) DeleteTargets(ctx context.Context, scope applicationimagegeneration.Scope, targetType domainimagegeneration.TargetType, targetIDs []string, now time.Time) error {
	for _, targetID := range targetIDs {
		ids, err := d.runs.ListRunIDsByTargets(ctx, scope, targetType, []string{targetID})
		if err != nil {
			return err
		}
		for _, id := range ids {
			if err = d.queue.Enqueue(ctx, scope.TenantID, imageTaskCleanupJobKind, id, applicationimagegeneration.CancelInput{
				Scope: scope, TargetType: targetType, TargetID: targetID, TaskRunID: id,
			}); err != nil {
				return err
			}
		}
	}
	return d.engine.ReleaseOutputsByTargets(ctx, scope, targetType, targetIDs, now)
}

type canvasNodeVisibility interface {
	HideByCanvasNodes(context.Context, applicationcanvas.Scope, []string, time.Time) error
}

type assetGenerationVisibility struct {
	history canvasNodeVisibility
	video   canvasNodeVisibility
	image   imageGenerationVisibility
}

func (visibility assetGenerationVisibility) HideByCanvasNodes(ctx context.Context, scope applicationcanvas.Scope, ids []string, hiddenAt time.Time) error {
	return errors.Join(
		visibility.history.HideByCanvasNodes(ctx, scope, ids, hiddenAt),
		visibility.video.HideByCanvasNodes(ctx, scope, ids, hiddenAt),
		visibility.image.HideByCanvasNodes(ctx, scope, ids, hiddenAt),
	)
}

type imageGenerationVisibility struct{ cleanup resourceGenerationDeletion }

func (visibility imageGenerationVisibility) HideByCanvasNodes(ctx context.Context, scope applicationcanvas.Scope, ids []string, hiddenAt time.Time) error {
	return visibility.cleanup.DeleteTargets(ctx, applicationimagegeneration.Scope{
		TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CallerID: scope.CallerID,
	}, domainimagegeneration.TargetCanvasNode, ids, hiddenAt)
}
