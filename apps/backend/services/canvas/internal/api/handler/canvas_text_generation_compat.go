package http

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	stdhttp "net/http"
	"strings"
	"time"

	applicationtext "github.com/example/monorepo/canvas/internal/application/canvastextgeneration"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

const (
	legacyTextGenerationStreamLifetime = 65 * time.Minute
	legacyTextGenerationPollInterval   = 100 * time.Millisecond
	legacyTextGenerationHeartbeat      = 15 * time.Second
)

// StreamLegacyCanvasNodeTextGeneration keeps already-open pre-Canvas-SSE
// clients usable during a deployment. The durable task and checkpoint tables
// remain authoritative; this endpoint only projects them into the retired wire
// shape and never writes graph state or owns task cancellation.
func (h *CanvasNodeHandler) StreamLegacyCanvasNodeTextGeneration(
	ctx context.Context,
	w stdhttp.ResponseWriter,
	_ *stdhttp.Request,
	projectID, canvasID, nodeID string,
	workspaceID *string,
) error {
	if err := requireAction(ctx, "StartCanvasNodeTextGeneration"); err != nil {
		return err
	}
	if h.textGenerations == nil {
		return errno.New(errno.ErrConfigurationError)
	}
	flusher, ok := w.(stdhttp.Flusher)
	if !ok {
		return errno.New(errno.ErrConfigurationError)
	}
	scope := canvasnodeScope(ctx, workspaceID)
	state, err := h.textGenerations.Start(ctx, scope, projectID, canvasID, nodeID)
	if err != nil {
		return err
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(stdhttp.StatusOK)
	if writeLegacyTextGenerationSSE(w, flusher, "heartbeat", struct{}{}) != nil ||
		writeLegacyTextGenerationSSE(w, flusher, "session", legacyTextGenerationSession(state)) != nil {
		return nil
	}

	streamCtx, cancel := context.WithTimeout(ctx, legacyTextGenerationStreamLifetime)
	defer cancel()
	poll := time.NewTicker(legacyTextGenerationPollInterval)
	defer poll.Stop()
	heartbeat := time.NewTicker(legacyTextGenerationHeartbeat)
	defer heartbeat.Stop()
	content := state.Content
	for {
		select {
		case <-streamCtx.Done():
			return nil
		case <-heartbeat.C:
			if writeLegacyTextGenerationSSE(w, flusher, "heartbeat", struct{}{}) != nil {
				return nil
			}
		case <-poll.C:
			next, getErr := h.textGenerations.Get(streamCtx, scope, projectID, canvasID, nodeID, state.ID)
			if getErr != nil {
				return nil
			}
			if !strings.HasPrefix(next.Content, content) {
				return errors.New("durable text generation checkpoint is not append-only")
			}
			if len(next.Content) > len(content) {
				delta := next.Content[len(content):]
				content = next.Content
				if writeLegacyTextGenerationSSE(w, flusher, "delta", map[string]any{"delta": delta, "offset": len(content)}) != nil {
					return nil
				}
			}
			state = next
			switch state.Status {
			case applicationtext.StatusSucceeded:
				_ = writeLegacyTextGenerationSSE(w, flusher, "completed", map[string]any{"task_run_id": state.ID, "content": state.Content})
				return nil
			case applicationtext.StatusFailed, applicationtext.StatusCancelled:
				_ = writeLegacyTextGenerationSSE(w, flusher, "session", legacyTextGenerationSession(state))
				return nil
			}
		}
	}
}

func legacyTextGenerationSession(state applicationtext.Session) map[string]any {
	value := map[string]any{
		"task_run_id": state.ID,
		"node_id":     state.NodeID,
		"status":      generationStatusDTO(string(state.Status)),
		"content":     state.Content,
	}
	if state.Failure != nil {
		value["error_code"] = state.Failure.Code
		value["error_message"] = state.Failure.Message
	}
	return value
}

func writeLegacyTextGenerationSSE(w stdhttp.ResponseWriter, flusher stdhttp.Flusher, event string, value any) error {
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
