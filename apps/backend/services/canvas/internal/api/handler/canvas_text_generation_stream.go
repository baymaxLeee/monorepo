package http

import (
	"context"
	"encoding/json"
	"fmt"
	stdhttp "net/http"
	"time"

	thriftcanvasnode "github.com/example/monorepo/canvas/internal/api/contracts/canvasnode"
	applicationcanvastextgeneration "github.com/example/monorepo/canvas/internal/application/canvastextgeneration"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

const (
	textGenerationStreamLifetime  = 65 * time.Minute
	textGenerationStreamReadBlock = time.Second
	textGenerationHeartbeat       = 15 * time.Second
)

func (h *CanvasNodeHandler) StreamCanvasNodeTextGeneration(
	ctx context.Context,
	w stdhttp.ResponseWriter,
	request *thriftcanvasnode.StartCanvasNodeTextGenerationRequest,
) error {
	scope := canvasnodeScope(ctx, request.WorkspaceID)
	state, err := h.textGenerations.Start(ctx, scope, request.ProjectID, request.CanvasID, request.NodeID)
	if err != nil {
		return err
	}
	flusher, ok := w.(stdhttp.Flusher)
	if !ok {
		return errno.New(errno.ErrConfigurationError)
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(stdhttp.StatusOK)
	streamCtx, cancel := context.WithTimeout(ctx, textGenerationStreamLifetime)
	defer cancel()
	if writeTextGenerationSSE(w, flusher, "heartbeat", map[string]any{}) != nil ||
		writeTextGenerationSSE(w, flusher, "session", textGenerationSessionEvent(state)) != nil {
		return nil
	}
	cursor := "0-0"
	offset := len(state.Content)
	nextHeartbeat := time.Now().Add(textGenerationHeartbeat)
	drain := func(block time.Duration) bool {
		events, readErr := h.textGenerations.ReadDeltas(
			streamCtx, scope, state.ProjectID, state.CanvasID, state.NodeID, state.ID, cursor, block,
		)
		if readErr != nil {
			return false
		}
		for _, event := range events {
			cursor = event.Cursor
			offset += len(event.Text)
			if writeTextGenerationSSE(w, flusher, "delta", map[string]any{"delta": event.Text, "offset": offset}) != nil {
				return false
			}
		}
		return true
	}
	for {
		switch state.Status {
		case applicationcanvastextgeneration.StatusSucceeded:
			if !drain(time.Millisecond) {
				return nil
			}
			_ = writeTextGenerationSSE(w, flusher, "completed", map[string]any{"task_run_id": state.ID, "content": state.Content})
			return nil
		case applicationcanvastextgeneration.StatusFailed, applicationcanvastextgeneration.StatusCancelled:
			if drain(time.Millisecond) {
				_ = writeTextGenerationSSE(w, flusher, "session", textGenerationSessionEvent(state))
			}
			return nil
		}
		if !drain(textGenerationStreamReadBlock) {
			return nil
		}
		if !time.Now().Before(nextHeartbeat) {
			if writeTextGenerationSSE(w, flusher, "heartbeat", map[string]any{}) != nil {
				return nil
			}
			nextHeartbeat = time.Now().Add(textGenerationHeartbeat)
		}
		next, getErr := h.textGenerations.Get(streamCtx, scope, state.ProjectID, state.CanvasID, state.NodeID, state.ID)
		if getErr != nil {
			return nil
		}
		state = next
	}
}

func textGenerationSessionEvent(state applicationcanvastextgeneration.Session) map[string]any {
	value := textGenerationSessionDTO(state)
	return map[string]any{
		"task_run_id":   value.TaskRunID,
		"node_id":       value.NodeID,
		"status":        value.Status,
		"content":       value.Content,
		"error_code":    value.ErrorCode,
		"error_message": value.ErrorMessage,
	}
}

func writeTextGenerationSSE(w stdhttp.ResponseWriter, flusher stdhttp.Flusher, event string, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if _, err = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, payload); err != nil {
		return err
	}
	flusher.Flush()
	return nil
}
