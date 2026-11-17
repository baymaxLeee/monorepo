package domain

import "testing"

func pointer[T any](value T) *T { return &value }

func TestParseSkillMarkdownAndValidateWorkspace(t *testing.T) {
	name, description, body, err := ParseSkillMarkdown("---\nname: demo-skill\ndescription: \"A useful skill\"\n---\n# Instructions\n")
	if err != nil {
		t.Fatal(err)
	}
	if name != "demo-skill" || description != "A useful skill" || body != "# Instructions" {
		t.Fatalf("unexpected parsed manifest: %q %q %q", name, description, body)
	}
	nodes := []SkillNode{
		{ID: "manifest", Name: "SKILL.md", NodeType: "file", StorageKind: "inline", Content: pointer("manifest")},
		{ID: "dir", Name: "references", NodeType: "directory"},
		{ID: "ref", ParentID: pointer("dir"), Name: "guide.md", NodeType: "file", StorageKind: "inline", Content: pointer("guide")},
	}
	if err := ValidateWorkspace(nodes); err != nil {
		t.Fatal(err)
	}
	first, err := WorkspaceHash(nodes)
	if err != nil {
		t.Fatal(err)
	}
	second, err := WorkspaceHash([]SkillNode{nodes[2], nodes[0], nodes[1]})
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Fatalf("workspace hash must not depend on query order: %s != %s", first, second)
	}
}

func TestValidateWorkspaceRejectsCycles(t *testing.T) {
	nodes := []SkillNode{
		{ID: "manifest", Name: "SKILL.md", NodeType: "file", StorageKind: "inline", Content: pointer("manifest")},
		{ID: "a", ParentID: pointer("b"), Name: "a", NodeType: "directory"},
		{ID: "b", ParentID: pointer("a"), Name: "b", NodeType: "directory"},
	}
	if err := ValidateWorkspace(nodes); err == nil {
		t.Fatal("expected cyclic workspace to be rejected")
	}
}
