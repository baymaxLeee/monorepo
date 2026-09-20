package main

import (
	"encoding/json"
	api "github.com/example/monorepo/canvas/internal/api/http"
	"os"
)

func main() {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(api.OpenAPI()); err != nil {
		panic(err)
	}
}
