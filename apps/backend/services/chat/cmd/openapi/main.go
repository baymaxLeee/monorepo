package main

import (
	"bytes"
	"fmt"
	"os"

	"github.com/example/monorepo/chat/internal/api/openapi"
)

func main() {
	const runtimePath = "../../../../schemas/openapi/runtime-server.json"
	const chatPath = "../../../../schemas/openapi/chat-server.json"
	spec, err := openapi.ProjectFile(runtimePath)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if existing, readErr := os.ReadFile(chatPath); readErr == nil && openapi.Equivalent(spec, existing) {
		spec = existing
	}
	_, _ = os.Stdout.Write(bytes.TrimRight(spec, "\n"))
	_, _ = os.Stdout.WriteString("\n")
}
