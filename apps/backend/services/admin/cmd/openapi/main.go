package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log"
	"os"

	adminapi "github.com/example/monorepo/admin/internal/api/generated/adminapi"
	"github.com/getkin/kin-openapi/openapi3"
)

func main() {
	spec, err := adminapi.GetSwagger()
	if err != nil {
		log.Fatal(err)
	}
	restoreOperationIDs(spec)
	canonical, err := readCanonicalDocument("../../../../schemas/openapi/admin-server.json", spec)
	if err != nil {
		log.Fatal(err)
	}
	_, _ = os.Stdout.Write(canonical)
	if len(canonical) == 0 || canonical[len(canonical)-1] != '\n' {
		_, _ = os.Stdout.WriteString("\n")
	}
}

func readCanonicalDocument(path string, generated *openapi3.T) ([]byte, error) {
	document, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var header struct {
		OpenAPI string `json:"openapi"`
	}
	if err := json.Unmarshal(document, &header); err != nil {
		return nil, err
	}
	if header.OpenAPI != "3.1.0" {
		return nil, fmt.Errorf("Admin canonical OpenAPI is %s, expected 3.1.0", header.OpenAPI)
	}
	expected, _ := generated.Extensions["x-canonical-sha256"].(string)
	actual := fmt.Sprintf("%x", sha256.Sum256(document))
	if expected == "" || expected != actual {
		return nil, fmt.Errorf("Admin generated server binding is stale: run just gen-admin-server")
	}
	return document, nil
}

func restoreOperationIDs(spec *openapi3.T) {
	for _, pathItem := range spec.Paths.Map() {
		for _, operation := range pathItem.Operations() {
			original, ok := operation.Extensions["x-original-operation-id"].(string)
			if !ok || original == "" {
				continue
			}
			operation.OperationID = original
			delete(operation.Extensions, "x-original-operation-id")
		}
	}
}
