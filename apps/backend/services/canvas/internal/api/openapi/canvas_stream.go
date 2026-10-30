package openapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	stream "github.com/example/monorepo/canvas/internal/application/canvasstream"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
	"github.com/go-chi/chi/v5"
)

var errCanvasFrameTooLarge = errors.New("canvas patch exceeds frame budget")

func (transport *Router) canvasStream(ctx context.Context, w http.ResponseWriter, r *http.Request) error {
	raw := r.Header.Get("Last-Event-ID")
	if raw == "" {
		raw = r.URL.Query().Get("cursor")
	}
	cursor, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || cursor <= 0 {
		return errno.New(errno.ErrInvalidArgument)
	}
	workspace := metadataWorkspace(r)
	project, canvas := chi.URLParam(r, "projectId"), chi.URLParam(r, "canvasId")
	events, err := transport.nodes.CanvasEvents(ctx, &workspace, project, canvas, cursor)
	if err != nil && !errors.Is(err, stream.ErrCursorExpired) {
		return err
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	rc := http.NewResponseController(w)
	send := func(name string, id int64, value any) error {
		payload, e := json.Marshal(toSnakeJSON(value))
		if e != nil {
			return e
		}
		if len(payload) > 16*1024*1024 {
			return errCanvasFrameTooLarge
		}
		if e = rc.SetWriteDeadline(time.Now().Add(10 * time.Second)); e != nil && !errors.Is(e, http.ErrNotSupported) {
			return e
		}
		defer rc.SetWriteDeadline(time.Time{})
		prefix := ""
		if id > 0 {
			prefix = fmt.Sprintf("id: %d\n", id)
		}
		if _, e = fmt.Fprintf(w, "%sevent: %s\ndata: %s\n\n", prefix, name, payload); e != nil {
			return e
		}
		return rc.Flush()
	}
	if send("heartbeat", 0, struct{}{}) != nil {
		return nil
	}
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	lifetime := time.NewTimer(65 * time.Minute)
	defer lifetime.Stop()
	for {
		if err != nil {
			_ = send("canvas.resync_required", 0, struct{}{})
			return nil
		}
		for _, event := range events {
			if sendError := send("canvas.patch", event.Cursor, event); sendError != nil {
				if errors.Is(sendError, errCanvasFrameTooLarge) {
					_ = send("canvas.resync_required", 0, struct{}{})
				}
				return nil
			}
			cursor = event.Cursor
		}
		select {
		case <-ctx.Done():
			return nil
		case <-lifetime.C:
			return nil
		case <-heartbeat.C:
			if send("heartbeat", 0, struct{}{}) != nil {
				return nil
			}
			events = nil
		case <-ticker.C:
			events, err = transport.nodes.CanvasEvents(ctx, &workspace, project, canvas, cursor)
		}
	}
}
