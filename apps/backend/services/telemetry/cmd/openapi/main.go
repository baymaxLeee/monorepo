package main

import (
	"fmt"
	"os"

	"github.com/example/monorepo/telemetry/internal/api/openapi"
)

func main() {
	document, err := openapi.JSON()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println(string(document))
}
