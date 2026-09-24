package coverimage

import "testing"

func TestLifecycleKeySeparatesOwnersAndGenerations(t *testing.T) {
	first := LifecycleKey("canvas_cover", "owner", 1)
	keys := []string{
		LifecycleKey("canvas_cover", "other", 1),
		LifecycleKey("project_cover", "owner", 1),
		LifecycleKey("canvas_cover", "owner", 2),
	}
	if first == "" {
		t.Fatal("lifecycle key is empty")
	}
	for _, key := range keys {
		if key == first {
			t.Fatalf("lifecycle keys collide: %q", key)
		}
	}
}

func TestLifecycleKeyRejectsIncompleteIdentity(t *testing.T) {
	for _, key := range []string{
		LifecycleKey("", "owner", 1),
		LifecycleKey("canvas_cover", "", 1),
		LifecycleKey("canvas_cover", "owner", 0),
	} {
		if key != "" {
			t.Fatalf("invalid lifecycle key = %q, want empty", key)
		}
	}
}
