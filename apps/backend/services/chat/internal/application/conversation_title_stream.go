package application

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

const maxObservedSSEFrameBytes = 64 * 1024

type conversationTitleBody struct {
	io.ReadCloser
	observer *conversationTitleObserver
}

func (body *conversationTitleBody) Read(target []byte) (int, error) {
	count, err := body.ReadCloser.Read(target)
	if count > 0 {
		body.observer.write(target[:count])
	}
	return count, err
}

type conversationTitleObserver struct {
	pending  []byte
	dropping bool
	done     bool
	onTitle  func(string)
}

func (service *Service) observeConversationTitle(
	ctx context.Context,
	scope AuthContext,
	product Conversation,
	response *http.Response,
) {
	if response == nil || response.Body == nil || response.StatusCode < 200 || response.StatusCode >= 300 ||
		!strings.Contains(response.Header.Get("Content-Type"), "text/event-stream") || !isAutoNamableTitle(product.Title) {
		return
	}
	observer := &conversationTitleObserver{onTitle: func(title string) {
		updateCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if _, err := service.repository.UpdateTitleIfDefault(updateCtx, scope, product.ID, title); err != nil {
			slog.ErrorContext(updateCtx, "conversation title persistence failed", "error", err, "conversation_id", product.ID)
		}
	}}
	response.Body = &conversationTitleBody{ReadCloser: response.Body, observer: observer}
}

func (observer *conversationTitleObserver) write(chunk []byte) {
	if observer.done || len(chunk) == 0 {
		return
	}
	observer.pending = append(observer.pending, chunk...)
	for {
		frameEnd, separatorLength := nextSSEFrame(observer.pending)
		if frameEnd < 0 {
			if len(observer.pending) > maxObservedSSEFrameBytes {
				observer.pending = observer.pending[:0]
				observer.dropping = true
			}
			return
		}
		frame := observer.pending[:frameEnd]
		observer.pending = observer.pending[frameEnd+separatorLength:]
		if observer.dropping {
			observer.dropping = false
			continue
		}
		title := conversationTitleFromSSEFrame(frame)
		if title == "" {
			continue
		}
		observer.done = true
		observer.onTitle(title)
		return
	}
}

func nextSSEFrame(buffer []byte) (int, int) {
	frameEnd, separatorLength := -1, 0
	for _, separator := range [][]byte{[]byte("\n\n"), []byte("\r\n\r\n"), []byte("\r\r")} {
		if index := bytes.Index(buffer, separator); index >= 0 && (frameEnd < 0 || index < frameEnd) {
			frameEnd, separatorLength = index, len(separator)
		}
	}
	return frameEnd, separatorLength
}

func conversationTitleFromSSEFrame(frame []byte) string {
	normalized := strings.ReplaceAll(strings.ReplaceAll(string(frame), "\r\n", "\n"), "\r", "\n")
	dataLines := make([]string, 0, 1)
	for _, line := range strings.Split(normalized, "\n") {
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		dataLines = append(dataLines, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
	}
	if len(dataLines) == 0 {
		return ""
	}
	var event struct {
		Type string `json:"type"`
		Data struct {
			Title string `json:"title"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(strings.Join(dataLines, "\n")), &event); err != nil || event.Type != "data-conversation-title" {
		return ""
	}
	title := strings.TrimSpace(event.Data.Title)
	if !utf8.ValidString(title) || utf8.RuneCountInString(title) < 1 || utf8.RuneCountInString(title) > 200 {
		return ""
	}
	return title
}
