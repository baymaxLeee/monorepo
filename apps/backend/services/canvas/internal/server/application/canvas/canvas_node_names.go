package canvas

import (
	"strconv"
	"strings"
	"unicode"

	domain "github.com/example/monorepo/canvas/internal/server/domain/canvas"
)

func numberedCanvasNodeType(nodeType domain.NodeType) bool {
	return nodeType == domain.NodeTypeText ||
		nodeType == domain.NodeTypeImageGeneration ||
		nodeType == domain.NodeTypeVideoGeneration ||
		nodeType == domain.NodeTypeTextGeneration
}

func defaultCanvasNodeName(nodeType domain.NodeType) (string, error) {
	name := domain.DefaultCanvasNodeName(nodeType)
	if name == "" {
		return "", domain.ErrInvalidCanvasNode
	}
	return name, nil
}

func allocateNumberedCanvasNodeName(nodes []domain.CanvasNode, nodeType domain.NodeType) (string, error) {
	base, err := defaultCanvasNodeName(nodeType)
	if err != nil || !numberedCanvasNodeType(nodeType) {
		return "", domain.ErrInvalidCanvasNode
	}
	baseExists := false
	maximum := 1
	for _, node := range nodes {
		if node.Name == base {
			baseExists = true
			continue
		}
		if !strings.HasPrefix(node.Name, base) {
			continue
		}
		suffix := strings.TrimPrefix(node.Name, base)
		sequence, parseErr := strconv.Atoi(suffix)
		if parseErr == nil && sequence >= 2 && sequence > maximum {
			maximum = sequence
		}
	}
	if !baseExists {
		return base, nil
	}
	return base + strconv.Itoa(maximum+1), nil
}

func canvasNodeNameFromSource(source string, nodeType domain.NodeType) (string, error) {
	invalidBoundary := func(value rune) bool {
		return value == '-' || value == '_' || unicode.IsSpace(value)
	}
	characters := []rune(strings.TrimFunc(source, invalidBoundary))
	if len(characters) > 50 {
		characters = characters[:50]
	}
	name := strings.TrimFunc(string(characters), invalidBoundary)
	if name != "" && domain.ValidCanvasNodeName(name) {
		return name, nil
	}
	return defaultCanvasNodeName(nodeType)
}
