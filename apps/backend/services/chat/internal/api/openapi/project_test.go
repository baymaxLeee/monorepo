package openapi

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func TestProjectionMatchesPublishedChatContract(t *testing.T) {
	runtimeDocument, err := os.ReadFile("../../../../../../../schemas/openapi/runtime-server.json")
	if err != nil {
		t.Fatal(err)
	}
	chatDocument, err := os.ReadFile("../../../../../../../schemas/openapi/chat-server.json")
	if err != nil {
		t.Fatal(err)
	}
	projected, err := Project(runtimeDocument)
	if err != nil {
		t.Fatal(err)
	}
	var got, want any
	if err := json.Unmarshal(projected, &got); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(chatDocument, &want); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatal("Go Chat OpenAPI projection differs from schemas/openapi/chat-server.json")
	}
}
