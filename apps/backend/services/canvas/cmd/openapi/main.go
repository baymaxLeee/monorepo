package main

import (
	"encoding/json"
	"os"

	"github.com/example/monorepo/canvas/internal/api/openapi"
)

func main() {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(openapi.Spec()); err != nil {
		panic(err)
	}
}
