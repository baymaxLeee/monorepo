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

type captureTextClient struct{ request *responses.ResponsesRequest }

func (client *captureTextClient) CreateResponsesStream(_ context.Context, request *responses.ResponsesRequest) (providerclient.ResponsesStream, error) {
	client.request = request
	return eofResponsesStream{}, nil
}

type eofResponsesStream struct{}

func (eofResponsesStream) Recv() (*responses.Event, error) { return nil, io.EOF }
func (eofResponsesStream) Close() error                    { return nil }
func (eofResponsesStream) Header() http.Header             { return http.Header{} }

func TestTextProviderSendsPlainResponseRequestWithoutAgentTools(t *testing.T) {
	client := &captureTextClient{}
	provider := newTextProvider(client)
	_, err := provider.Generate(context.Background(), app.ProviderInput{
		TaskRunID: "run-1", CallOrdinal: 1,
		Selection: appSelection("provider-text"), Prompt: "write a paragraph",
		Emit: func(string) error { return nil },
	})
	if err == nil {
		t.Fatal("expected the synthetic EOF stream to fail")
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
}

func appSelection(modelID string) applicationmodel.Selection {
	return applicationmodel.Selection{ModelID: modelID}
}
