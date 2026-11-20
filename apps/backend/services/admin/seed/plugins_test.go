package seed

import (
	"github.com/example/monorepo/admin/internal/infrastructure/persistence"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"reflect"
	"testing"

	"github.com/example/monorepo/admin/internal/application"
	"github.com/example/monorepo/admin/internal/domain"
)

func TestSystemReleasesShipTwoIndependentlySelectableReadTools(t *testing.T) {
	seeds, err := systemReleases("https://knowledge.test", "https://canvas.test")
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"knowledge@platform": "knowledge_search", "canvas@platform": "get_canvas_context"}
	if len(seeds) != len(want) {
		t.Fatalf("unexpected seed count: %d", len(seeds))
	}
	for _, seed := range seeds {
		m := seed.Manifest
		if err := application.ValidateAgentPluginManifest(m); err != nil {
			t.Fatal(err)
		}
		if !seed.Catalog.Listed || seed.Catalog.Availability != "available" || seed.Catalog.InstallPolicy != domain.AgentPluginAvailable || len(m.MCPServers) != 1 {
			t.Fatalf("invalid catalog defaults for %s", m.ID)
		}
		srv := m.MCPServers[0]
		if srv.URL != "https://"+srv.Name+".test/mcp" || len(srv.Tools) != 1 || srv.Tools[0].Name != want[m.ID] || srv.Tools[0].Policy.Effect != "read" {
			t.Fatalf("unexpected MCP release %s: %+v", m.ID, srv)
		}
		if m.ID == "canvas@platform" && !reflect.DeepEqual(srv.BindingHeaders, map[string]string{"X-Project-ID": "project_id", "X-Canvas-ID": "canvas_id"}) {
			t.Fatal("missing canvas binding")
		}
		delete(want, m.ID)
	}
	if len(want) != 0 {
		t.Fatalf("missing releases: %v", want)
	}
}

// Run against a migrated Admin database. All test writes belong to the outer transaction.
func TestPublishedBuiltinsInstallAndResolveFromPostgres(t *testing.T) {
	if os.Getenv("ADMIN_PLUGIN_POSTGRES_INTEGRATION") != "1" {
		t.Skip("requires PostgreSQL")
	}
	ctx := t.Context()
	pool, err := pgxpool.New(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	svc := application.NewAgentPluginService(persistence.AgentPluginRepository{Pool: pool, DB: tx}, nil, persistence.ErrorClassifier{})
	if err := PublishPlugins(ctx, svc, "http://knowledge:8010", "http://canvas:8012"); err != nil {
		t.Fatal(err)
	}
	actor := application.Actor{UserID: "seed-test", TenantID: "seed-test", WorkspaceID: "seed-test", WorkspaceRole: "workspace_admin"}
	for _, id := range []string{"knowledge@platform", "canvas@platform"} {
		if _, err := svc.Install(ctx, actor, application.InstallAgentPluginInput{PluginID: id, Enabled: true}); err != nil {
			t.Fatal(err)
		}
	}
	available, err := svc.ListSelectionOptions(ctx, actor)
	if err != nil || len(available) != 2 {
		t.Fatalf("workspace options: %+v, %v", available, err)
	}
	if _, err := svc.Resolve(ctx, actor, []domain.AgentPluginActivation{{PluginID: "canvas@platform"}}); err == nil {
		t.Fatal("unbound canvas was admitted")
	}
	selected := []domain.AgentPluginActivation{{PluginID: "knowledge@platform"}, {PluginID: "canvas@platform", Bindings: map[string]string{"canvas_id": "canvas", "project_id": "project"}}}
	resolved, err := svc.Resolve(ctx, actor, selected)
	if err != nil || len(resolved.Plugins) != 2 || len(resolved.ConnectionGrants) != 2 {
		t.Fatalf("resolve failed: %v", err)
	}
	for _, grant := range resolved.ConnectionGrants {
		if grant.Headers["X-Auth-Workspace-ID"] != actor.WorkspaceID {
			t.Fatal("missing workspace scope")
		}
		if grant.PluginID == "canvas@platform" && (grant.Headers["X-Canvas-ID"] != "canvas" || grant.Headers["X-Project-ID"] != "project") {
			t.Fatal("missing canvas scope")
		}
	}
}
