package provider

import (
	"context"
	"io"
	"net/http"
	"testing"

	app "github.com/example/monorepo/canvas/internal/application/canvastextgeneration"
	applicationmodel "github.com/example/monorepo/canvas/internal/application/model"
	providerclient "github.com/example/monorepo/canvas/internal/infrastructure/provider/client"
	"github.com/volcengine/volcengine-go-sdk/service/arkruntime/model/responses"
)

type captureTextClient struct {
	request *responses.ResponsesRequest
	stream  providerclient.ResponsesStream
}

func (client *captureTextClient) CreateResponsesStream(_ context.Context, request *responses.ResponsesRequest) (providerclient.ResponsesStream, error) {
	client.request = request
	return client.stream, nil
}

type textResponsesStream struct {
	events []*responses.Event
	index  int
}

func (stream *textResponsesStream) Recv() (*responses.Event, error) {
	if stream.index >= len(stream.events) {
		return nil, io.EOF
	}
	event := stream.events[stream.index]
	stream.index++
	return event, nil
}
func (*textResponsesStream) Close() error { return nil }
func (*textResponsesStream) Header() http.Header {
	return http.Header{providerclient.HeaderProviderRequestID: []string{"request-1"}}
}

func TestTextProviderSendsPlainResponseRequestWithoutAgentTools(t *testing.T) {
	delta := "generated text"
	client := &captureTextClient{stream: &textResponsesStream{events: []*responses.Event{
		{Event: &responses.Event_Text{Text: &responses.OutputTextEvent{Delta: &delta}}},
		{Event: &responses.Event_ResponseCompleted{ResponseCompleted: &responses.ResponseCompletedEvent{Response: &responses.ResponseObject{Status: responses.ResponseStatus_completed}}}},
	}}}
	provider := newTextProvider(client)
	var emitted string
	result, err := provider.Generate(context.Background(), app.ProviderInput{
		TaskRunID: "run-1", CallOrdinal: 1,
		Selection: appSelection("provider-text"), Prompt: "write a paragraph",
		Emit: func(content string) error { emitted += content; return nil },
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if client.request == nil {
		t.Fatal("text provider did not issue a Responses request")
	}
	if len(client.request.Tools) != 0 || client.request.ToolChoice != nil {
		t.Fatalf("Canvas text generation must not inject agent tools: %#v", client.request.Tools)
	}
	if client.request.Model != "provider-text" {
		t.Fatalf("unexpected provider id: %q", client.request.Model)
	}
	if client.request.GetStore() {
		t.Fatal("Canvas text generation must not create provider-side conversation state")
	}
	if emitted != "generated text" {
		t.Fatalf("emitted text = %q", emitted)
	}
	if result.Call.RequestID != "request-1" || !result.Call.RequestAttempted {
		t.Fatalf("provider call metadata = %#v", result.Call)
	}
}

func TestTextProviderRejectsStreamWithoutCompletion(t *testing.T) {
	provider := newTextProvider(&captureTextClient{stream: &textResponsesStream{}})
	_, err := provider.Generate(context.Background(), app.ProviderInput{
		TaskRunID: "run-1", CallOrdinal: 1,
		Selection: appSelection("provider-text"), Prompt: "write a paragraph",
	})
	if err == nil {
		t.Fatal("expected a stream without a completion event to fail")
	}
}

func appSelection(modelID string) applicationmodel.Selection {
	return applicationmodel.Selection{ModelID: modelID}
}
