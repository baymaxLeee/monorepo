package openapi

import (
	"encoding/json"
	"regexp"
	"testing"
)

func TestPathParametersMatchTemplates(t *testing.T) {
	raw, err := JSON()
	if err != nil {
		t.Fatal(err)
	}
	var spec struct {
		Paths map[string]map[string]json.RawMessage `json:"paths"`
	}
	if err := json.Unmarshal(raw, &spec); err != nil {
		t.Fatal(err)
	}
	type parameter struct {
		Name string `json:"name"`
		In   string `json:"in"`
	}
	pattern := regexp.MustCompile(`\{([^}]+)\}`)
	for path, item := range spec.Paths {
		var shared []parameter
		_ = json.Unmarshal(item["parameters"], &shared)
		for _, method := range []string{"get", "head", "post", "put"} {
			if item[method] == nil {
				continue
			}
			var operation struct {
				Parameters []parameter `json:"parameters"`
			}
			if err := json.Unmarshal(item[method], &operation); err != nil {
				t.Fatal(err)
			}
			declared := map[string]bool{}
			for _, p := range append(shared, operation.Parameters...) {
				if p.In == "path" {
					declared[p.Name] = true
				}
			}
			for _, match := range pattern.FindAllStringSubmatch(path, -1) {
				if !declared[match[1]] {
					t.Errorf("%s %s: missing parameter %s", method, path, match[1])
				}
				delete(declared, match[1])
			}
			if len(declared) != 0 {
				t.Errorf("%s %s: parameters absent from template: %v", method, path, declared)
			}
		}
	}
}
