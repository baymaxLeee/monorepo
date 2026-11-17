package domain

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
)

var (
	frontmatterPattern = regexp.MustCompile(`(?s)^---\r?\n(.*?)\r?\n---\r?\n?(.*)$`)
	nameLinePattern    = regexp.MustCompile(`(?m)^name:\s*(.+?)\s*$`)
	descriptionPattern = regexp.MustCompile(`(?m)^description:\s*(.+?)\s*$`)
	skillNamePattern   = regexp.MustCompile(`^[a-z](?:[a-z0-9]|-[a-z0-9])*$`)
)

type Skill struct {
	ID, UserID, WorkspaceID, TenantID, Username   string
	Name, Description, Status                     string
	IsEnabled                                     bool
	WorkspaceSeq                                  int
	WorkspaceSHA256, PublishedSHA256              *string
	PublishedAt                                   *time.Time
	PublishedName, PublishedDescription           *string
	SourceArchiveAssetID, SourceArchiveRevisionID *string
	CreatedAt, UpdatedAt                          time.Time
}

type SkillNode struct {
	ID, SkillID, Name, NodeType, StorageKind string
	ParentID, MimeType, Content              *string
	AssetID, RevisionID, SHA256              *string
	SizeBytes                                *int64
	SortOrder                                int
	CreatedAt, UpdatedAt                     time.Time
}

type PublishedSkillNode struct {
	SkillID, NodeID, Name, NodeType, StorageKind string
	ParentNodeID, MimeType, Content              *string
	AssetID, RevisionID, SHA256                  *string
	SizeBytes                                    *int64
	SortOrder                                    int
}

func (s Skill) HasUnpublishedChanges() bool {
	return stringValue(s.WorkspaceSHA256) != stringValue(s.PublishedSHA256)
}

func ValidateSkillName(name string) bool { return skillNamePattern.MatchString(name) }

func ValidateNodeName(name string) error {
	if name == "." || name == ".." || strings.ContainsAny(name, `/\`) {
		return fmt.Errorf("file names may not contain path separators")
	}
	return nil
}

func ParseSkillMarkdown(content string) (string, string, string, error) {
	match := frontmatterPattern.FindStringSubmatch(content)
	if match == nil {
		return "", "", "", fmt.Errorf("SKILL.md must start with YAML frontmatter")
	}
	nameMatch, descriptionMatch := nameLinePattern.FindStringSubmatch(match[1]), descriptionPattern.FindStringSubmatch(match[1])
	if nameMatch == nil || descriptionMatch == nil {
		return "", "", "", fmt.Errorf("SKILL.md frontmatter must declare name and description")
	}
	name, err := frontmatterScalar(nameMatch[1])
	if err != nil {
		return "", "", "", err
	}
	description, err := frontmatterScalar(descriptionMatch[1])
	if err != nil {
		return "", "", "", err
	}
	if !ValidateSkillName(name) {
		return "", "", "", fmt.Errorf("SKILL.md name must use lowercase letters, digits and single hyphens")
	}
	if description == "" || len(description) > 1024 {
		return "", "", "", fmt.Errorf("SKILL.md description must contain 1-1024 characters")
	}
	return name, description, strings.TrimSpace(match[2]), nil
}

func frontmatterScalar(value string) (string, error) {
	value = strings.TrimSpace(value)
	if strings.HasPrefix(value, `"`) {
		var parsed string
		if err := json.Unmarshal([]byte(value), &parsed); err != nil {
			return "", fmt.Errorf("invalid quoted frontmatter value: %w", err)
		}
		return parsed, nil
	}
	if len(value) >= 2 && strings.HasPrefix(value, "'") && strings.HasSuffix(value, "'") {
		return strings.ReplaceAll(value[1:len(value)-1], "''", "'"), nil
	}
	return value, nil
}

func NodeETag(node SkillNode) string {
	hash := sha256.New()
	for _, value := range []string{node.ID, stringValue(node.ParentID), node.Name, node.NodeType, stringValue(node.MimeType), stringValue(node.Content), node.StorageKind, stringValue(node.AssetID), stringValue(node.RevisionID), stringValue(node.SHA256)} {
		_, _ = hash.Write([]byte(value))
		_, _ = hash.Write([]byte{0})
	}
	return hex.EncodeToString(hash.Sum(nil))
}

func WorkspaceHash(nodes []SkillNode) (string, error) {
	paths, err := workspacePaths(nodes)
	if err != nil {
		return "", err
	}
	ordered := append([]SkillNode(nil), nodes...)
	sort.Slice(ordered, func(i, j int) bool { return paths[ordered[i].ID] < paths[ordered[j].ID] })
	hash := sha256.New()
	for _, node := range ordered {
		for _, value := range []string{paths[node.ID], node.NodeType, stringValue(node.Content), node.StorageKind, stringValue(node.AssetID), stringValue(node.RevisionID), stringValue(node.SHA256)} {
			_, _ = hash.Write([]byte(value))
			_, _ = hash.Write([]byte{0})
		}
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func ValidateWorkspace(nodes []SkillNode) error {
	if len(nodes) > 500 {
		return fmt.Errorf("a skill may contain at most 500 nodes")
	}
	if _, err := workspacePaths(nodes); err != nil {
		return err
	}
	_, err := RootSkillMarkdown(nodes)
	return err
}

func RootSkillMarkdown(nodes []SkillNode) (SkillNode, error) {
	var matches []SkillNode
	for _, node := range nodes {
		if node.ParentID == nil && node.Name == "SKILL.md" && node.NodeType == "file" {
			matches = append(matches, node)
		}
	}
	if len(matches) != 1 {
		return SkillNode{}, fmt.Errorf("workspace must contain exactly one root SKILL.md")
	}
	return matches[0], nil
}

func PublishedPaths(nodes []PublishedSkillNode) (map[string]string, error) {
	byID := make(map[string]PublishedSkillNode, len(nodes))
	for _, node := range nodes {
		byID[node.NodeID] = node
	}
	result := make(map[string]string, len(nodes))
	for id, node := range byID {
		parts, seen, parent := []string{node.Name}, map[string]bool{id: true}, node.ParentNodeID
		for parent != nil {
			if seen[*parent] {
				return nil, fmt.Errorf("published skill contains an invalid parent chain")
			}
			ancestor, ok := byID[*parent]
			if !ok {
				return nil, fmt.Errorf("published skill contains an invalid parent chain")
			}
			seen[*parent], parts, parent = true, append(parts, ancestor.Name), ancestor.ParentNodeID
		}
		reverse(parts)
		result[id] = strings.Join(parts, "/")
	}
	return result, nil
}

func workspacePaths(nodes []SkillNode) (map[string]string, error) {
	byID := make(map[string]SkillNode, len(nodes))
	for _, node := range nodes {
		byID[node.ID] = node
	}
	result := make(map[string]string, len(nodes))
	for id, node := range byID {
		parts, seen, parent := []string{node.Name}, map[string]bool{id: true}, node.ParentID
		for parent != nil {
			if seen[*parent] {
				return nil, fmt.Errorf("skill workspace contains an invalid parent chain")
			}
			ancestor, ok := byID[*parent]
			if !ok || ancestor.NodeType != "directory" {
				return nil, fmt.Errorf("node %s has an invalid parent", node.Name)
			}
			seen[*parent], parts, parent = true, append(parts, ancestor.Name), ancestor.ParentID
		}
		reverse(parts)
		result[id] = strings.Join(parts, "/")
	}
	return result, nil
}

func reverse(values []string) {
	for left, right := 0, len(values)-1; left < right; left, right = left+1, right-1 {
		values[left], values[right] = values[right], values[left]
	}
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
