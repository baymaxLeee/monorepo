package http

import (
	"context"
	"errors"

	"github.com/example/monorepo/canvas/internal/api/requestcontext"
	applicationcanvasarchive "github.com/example/monorepo/canvas/internal/application/canvasarchive"
	applicationfirstlastframe "github.com/example/monorepo/canvas/internal/application/firstlastframe"
	applicationtask "github.com/example/monorepo/canvas/internal/application/task"
	asynccontract "github.com/example/monorepo/canvas/internal/contract/asyncexecution"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

type asyncExecutionCoordinator interface {
	Claim(context.Context, string, domaintask.RunType) (domaintask.AsyncDispatch, bool, error)
	Heartbeat(context.Context, domaintask.AsyncDispatch) (domaintask.AsyncDispatch, bool, error)
	Release(context.Context, domaintask.AsyncDispatch) (bool, error)
	Complete(context.Context, domaintask.AsyncDispatch) (bool, error)
}

type AsyncExecutionHandler struct {
	coordinator asyncExecutionCoordinator
	processors  map[string]asyncExecutionProcessor
}

func newAsyncExecutionHandler(
	coordinator asyncExecutionCoordinator,
	archive archiveExecutionService,
	frameServices ...firstLastFrameExecutionService,
) *AsyncExecutionHandler {
	archiveProcessor := &archiveAsyncExecutionProcessor{service: archive}
	processors := map[string]asyncExecutionProcessor{archiveProcessor.RunType(): archiveProcessor}
	if len(frameServices) > 0 && frameServices[0] != nil {
		frameProcessor := &firstLastFrameAsyncExecutionProcessor{service: frameServices[0]}
		processors[frameProcessor.RunType()] = frameProcessor
	}
	return &AsyncExecutionHandler{coordinator: coordinator, processors: processors}
}

func NewAsyncExecutionHandler(
	coordinator *applicationtask.AsyncExecutionCoordinator,
	archive *applicationcanvasarchive.Service,
	frames *applicationfirstlastframe.Service,
) *AsyncExecutionHandler {
	if frames == nil {
		return newAsyncExecutionHandler(coordinator, archive)
	}
	return newAsyncExecutionHandler(coordinator, archive, frames)
}

func (handler *AsyncExecutionHandler) ClaimAsyncExecution(
	ctx context.Context,
	request *asynccontract.ClaimRequest,
) (*asynccontract.ClaimResponse, error) {
	processor, runType, err := handler.claimProcessor(ctx, request)
	if err != nil {
		return nil, err
	}
	dispatch, claimed, err := handler.coordinator.Claim(ctx, request.TaskRunID, runType)
	if err != nil {
		return nil, err
	}
	if !claimed {
		return &asynccontract.ClaimResponse{Directive: asynccontract.DirectiveStop}, nil
	}
	response := &asynccontract.ClaimResponse{
		Directive: asynccontract.DirectiveContinue, RunType: string(dispatch.RunType),
		ExecutionState: string(dispatch.ExecutionState), ExecutionVersion: dispatch.ExecutionVersion,
		ExecutionAttempts: dispatch.ExecutionAttempts, ExecutionToken: dispatch.ExecutionToken,
	}
	if dispatch.ExecutionState == domaintask.AsyncExecutionFailurePending {
		return response, nil
	}
	state, payload, err := processor.Get(ctx, request.TaskRunID)
	if err != nil {
		_, releaseErr := handler.coordinator.Release(ctx, dispatch)
		return nil, errors.Join(err, releaseErr)
	}
	switch state {
	case asyncExecutionStateReady:
		response.Payload = payload
		return response, nil
	case asyncExecutionStateRetry:
		if _, err = handler.coordinator.Release(ctx, dispatch); err != nil {
			return nil, err
		}
		return &asynccontract.ClaimResponse{Directive: asynccontract.DirectiveStop}, nil
	case asyncExecutionStateSucceeded, asyncExecutionStateTerminal:
		if _, err = handler.coordinator.Complete(ctx, dispatch); err != nil {
			return nil, err
		}
		return &asynccontract.ClaimResponse{Directive: asynccontract.DirectiveStop}, nil
	default:
		_, releaseErr := handler.coordinator.Release(ctx, dispatch)
		return nil, errors.Join(errors.New("invalid async execution payload state"), releaseErr)
	}
}

func (handler *AsyncExecutionHandler) HeartbeatAsyncExecution(
	ctx context.Context,
	request *asynccontract.HeartbeatRequest,
) (*asynccontract.HeartbeatResponse, error) {
	runType, err := handler.validateCommand(ctx, requestTaskRunID(request), requestRunType(request), requestVersion(request))
	if err != nil {
		return nil, err
	}
	renewed, continued, err := handler.coordinator.Heartbeat(ctx, domaintask.AsyncDispatch{
		TaskRunID: request.TaskRunID, RunType: runType,
		ExecutionState: domaintask.AsyncExecutionExecuting, ExecutionVersion: request.ExecutionVersion,
	})
	if err != nil {
		return nil, err
	}
	if !continued {
		return &asynccontract.HeartbeatResponse{Directive: asynccontract.DirectiveStop}, nil
	}
	return &asynccontract.HeartbeatResponse{
		Directive: asynccontract.DirectiveContinue, ExecutionVersion: renewed.ExecutionVersion,
	}, nil
}

func (handler *AsyncExecutionHandler) claimProcessor(
	ctx context.Context,
	request *asynccontract.ClaimRequest,
) (asyncExecutionProcessor, domaintask.RunType, error) {
	if request == nil {
		return nil, "", errno.New(errno.ErrInvalidArgument)
	}
	runType, err := handler.validateCommand(ctx, request.TaskRunID, request.RunType, 1)
	if err != nil {
		return nil, "", err
	}
	return handler.processors[request.RunType], runType, nil
}

func (handler *AsyncExecutionHandler) validateCommand(
	ctx context.Context,
	taskRunID string,
	runTypeValue string,
	version int64,
) (domaintask.RunType, error) {
	if err := requireAsyncServiceIdentity(ctx); err != nil {
		return "", err
	}
	if taskRunID == "" || runTypeValue == "" || version < 1 {
		return "", errno.New(errno.ErrInvalidArgument)
	}
	if _, ok := handler.processors[runTypeValue]; !ok {
		return "", errno.New(errno.ErrInvalidArgument)
	}
	return domaintask.RunType(runTypeValue), nil
}

func requireAsyncServiceIdentity(ctx context.Context) error {
	identityType, ok := topcontext.IdentityTypeFromContext(ctx)
	if !ok || identityType != asynccontract.ServiceIdentityType {
		return errno.New(errno.ErrForbidden)
	}
	return nil
}

func requestTaskRunID(request *asynccontract.HeartbeatRequest) string {
	if request == nil {
		return ""
	}
	return request.TaskRunID
}

func requestRunType(request *asynccontract.HeartbeatRequest) string {
	if request == nil {
		return ""
	}
	return request.RunType
}

func requestVersion(request *asynccontract.HeartbeatRequest) int64 {
	if request == nil {
		return 0
	}
	return request.ExecutionVersion
}
