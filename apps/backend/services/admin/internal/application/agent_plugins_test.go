package application

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/example/monorepo/admin/internal/domain"
)

var errPluginRowNotFound = errors.New("plugin row not found")

type pluginTestCipher struct{}

func (pluginTestCipher) Encrypt(value string) (string, error) { return "enc:" + value, nil }
func (pluginTestCipher) Decrypt(value string) (string, error) {
	if len(value) < 4 || value[:4] != "enc:" {
		return "", errors.New("invalid ciphertext")
	}
	return value[4:], nil
}

type pluginTestErrors struct{}

func (pluginTestErrors) IsNotFound(err error) bool { return errors.Is(err, errPluginRowNotFound) }

type pluginTestRepository struct {
	catalog       map[string]domain.AgentPluginCatalogEntry
	releases      map[string]domain.AgentPluginManifest
	installations map[string]domain.AgentPluginInstallation
	revisions     map[string]int64
}

func newPluginTestRepository() *pluginTestRepository {
	return &pluginTestRepository{
		catalog: map[string]domain.AgentPluginCatalogEntry{}, releases: map[string]domain.AgentPluginManifest{},
		installations: map[string]domain.AgentPluginInstallation{}, revisions: map[string]int64{},
	}
}

func (r *pluginTestRepository) Transaction(_ context.Context, fn func(AgentPluginRepository) error) error {
	return fn(r)
}

func (r *pluginTestRepository) GetCatalogEntry(_ context.Context, id string) (domain.AgentPluginCatalogEntry, error) {
	value, ok := r.catalog[id]
	if !ok {
		return domain.AgentPluginCatalogEntry{}, errPluginRowNotFound
	}
	return value, nil
}

func (r *pluginTestRepository) ListCatalog(_ context.Context, tenantID, workspaceID string) ([]domain.AgentPluginListItem, error) {
	ids := make([]string, 0, len(r.catalog))
	for id := range r.catalog {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	result := make([]domain.AgentPluginListItem, 0, len(ids))
	for _, id := range ids {
		catalog := r.catalog[id]
		if !catalog.Listed {
			continue
		}
		item := domain.AgentPluginListItem{Catalog: catalog, Manifest: r.releases[releaseKey(id, catalog.LatestReleaseDigest)]}
		if installation, ok := r.installations[installationKey(tenantID, workspaceID, id)]; ok {
			item.Installed = true
			item.Enabled = installation.Enabled
			item.StateRevision = installation.Revision
		}
		result = append(result, item)
	}
	return result, nil
}

func (r *pluginTestRepository) ListPluginSelectionCandidates(_ context.Context, tenantID, workspaceID string) ([]domain.AgentPluginSelectionCandidate, error) {
	ids := make([]string, 0, len(r.catalog))
	for id := range r.catalog {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	result := make([]domain.AgentPluginSelectionCandidate, 0, len(ids))
	for _, id := range ids {
		catalog := r.catalog[id]
		installation, installed := r.installations[installationKey(tenantID, workspaceID, id)]
		if !installed || !installation.Enabled || !catalog.Listed || catalog.Availability != "available" || catalog.InstallPolicy == domain.AgentPluginNotAvailable {
			continue
		}
		result = append(result, domain.AgentPluginSelectionCandidate{
			PluginID: id, DisplayName: catalog.DisplayName, Description: catalog.Description,
			InstallPolicy: catalog.InstallPolicy,
			Manifest:      r.releases[releaseKey(id, installation.ReleaseDigest)],
		})
	}
	return result, nil
}

func (r *pluginTestRepository) UpsertCatalogEntry(_ context.Context, value domain.AgentPluginCatalogEntry) error {
	r.catalog[value.ID] = value
	return nil
}

func (r *pluginTestRepository) GetRelease(_ context.Context, pluginID, digest string) (domain.AgentPluginManifest, error) {
	value, ok := r.releases[releaseKey(pluginID, digest)]
	if !ok {
		return domain.AgentPluginManifest{}, errPluginRowNotFound
	}
	return value, nil
}

func (r *pluginTestRepository) CreateRelease(_ context.Context, value domain.AgentPluginManifest) error {
	key := releaseKey(value.ID, value.Digest)
	if _, exists := r.releases[key]; exists {
		return errors.New("duplicate release")
	}
	r.releases[key] = value
	return nil
}

func (r *pluginTestRepository) GetInstallation(_ context.Context, tenantID, workspaceID, pluginID string) (domain.AgentPluginInstallation, error) {
	value, ok := r.installations[installationKey(tenantID, workspaceID, pluginID)]
	if !ok {
		return domain.AgentPluginInstallation{}, errPluginRowNotFound
	}
	return value, nil
}

func (r *pluginTestRepository) SaveInstallation(_ context.Context, value domain.AgentPluginInstallation) error {
	r.installations[installationKey(value.TenantID, value.WorkspaceID, value.PluginID)] = value
	return nil
}

func (r *pluginTestRepository) DeleteInstallation(_ context.Context, tenantID, workspaceID, pluginID string) (bool, error) {
	key := installationKey(tenantID, workspaceID, pluginID)
	if _, ok := r.installations[key]; !ok {
		return false, nil
	}
	delete(r.installations, key)
	return true, nil
}

func (r *pluginTestRepository) WorkspaceRevision(_ context.Context, tenantID, workspaceID string, _ bool) (int64, error) {
	key := workspaceKey(tenantID, workspaceID)
	if r.revisions[key] == 0 {
		r.revisions[key] = 1
	}
	return r.revisions[key], nil
}

func (r *pluginTestRepository) BumpWorkspaceRevision(_ context.Context, tenantID, workspaceID string, _ time.Time) (int64, error) {
	key := workspaceKey(tenantID, workspaceID)
	if r.revisions[key] == 0 {
		r.revisions[key] = 1
	}
	r.revisions[key]++
	return r.revisions[key], nil
}

func releaseKey(pluginID, digest string) string        { return pluginID + "\x00" + digest }
func workspaceKey(tenantID, workspaceID string) string { return tenantID + "\x00" + workspaceID }
func installationKey(tenantID, workspaceID, pluginID string) string {
	return workspaceKey(tenantID, workspaceID) + "\x00" + pluginID
}

func testAgentPluginManifest(t *testing.T, id, serverName string) domain.AgentPluginManifest {
	t.Helper()
	manifest, err := SealAgentPluginManifest(domain.AgentPluginManifest{
		SchemaVersion: 1,
		ID:            id,
		Version:       "1.0.0",
		DisplayName:   "Canvas",
		Description:   "Read the bound canvas.",
		Source:        domain.AgentPluginSourceSystem,
		Trust:         domain.AgentPluginTrustSystem,
		MCPServers: []domain.AgentPluginMCPServer{{
			Name:             serverName,
			URL:              "http://canvas:8012/mcp",
			RequiredBindings: []string{"project_id", "canvas_id"},
			BindingHeaders:   map[string]string{"X-Project-ID": "project_id", "X-Canvas-ID": "canvas_id"},
			SecretHeaders:    map[string]string{"Authorization": "access_token"},
			Tools: []domain.AgentPluginMCPTool{{
				Name: "get_canvas_context", Description: "Read the selected canvas.",
				InputSchema: json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`),
				Policy:      domain.AgentPluginToolPolicy{Capability: "files", Effect: "read", Trust: "closed", Execution: "inline"},
				Planning:    domain.AgentPluginToolPlanning{Summary: "Read the selected canvas.", Parallelizable: true},
			}},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	return manifest
}

func testAgentPluginService(t *testing.T) (AgentPluginService, *pluginTestRepository, domain.AgentPluginManifest) {
	t.Helper()
	repository := newPluginTestRepository()
	service := NewAgentPluginService(repository, pluginTestCipher{}, pluginTestErrors{})
	service.ResourceGrantKeys = map[string]string{"canvas": "canvas-secret", "knowledge": "knowledge-secret"}
	service.Now = func() time.Time { return time.Date(2026, 11, 19, 10, 0, 0, 0, time.UTC) }
	service.NewID = func() string { return "snapshot-1" }
	manifest := testAgentPluginManifest(t, "canvas@platform", "canvas")
	seed := AgentPluginReleaseSeed{
		Catalog: domain.AgentPluginCatalogEntry{
			ID: manifest.ID, DisplayName: manifest.DisplayName, Description: manifest.Description,
			Source: manifest.Source, Trust: manifest.Trust, InstallPolicy: domain.AgentPluginAvailable,
			Availability: "available", Listed: true,
		},
		Manifest: manifest,
	}
	if err := service.ReconcileSystemReleases(context.Background(), []AgentPluginReleaseSeed{seed}); err != nil {
		t.Fatal(err)
	}
	return service, repository, manifest
}

func TestAgentPluginInstallResolveAndSecretGrantLifecycle(t *testing.T) {
	service, repository, manifest := testAgentPluginService(t)
	actor := Actor{UserID: "user", TenantID: "tenant", WorkspaceID: "workspace", WorkspaceRole: "workspace_admin"}
	installed, err := service.Install(context.Background(), actor, InstallAgentPluginInput{
		PluginID: manifest.ID, Enabled: true, Secrets: map[string]string{"access_token": "Bearer secret"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if installed.Revision != 2 || installed.EncryptedSecrets["access_token"] != "enc:Bearer secret" {
		t.Fatalf("installed = %#v", installed)
	}
	snapshot, err := service.Resolve(context.Background(), actor, []domain.AgentPluginActivation{{
		PluginID: manifest.ID, Bindings: map[string]string{"project_id": "project", "canvas_id": "canvas"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.SchemaVersion != 1 || snapshot.SnapshotID != "snapshot-1" || snapshot.WorkspaceRevision != 2 || !digestPattern.MatchString(snapshot.SnapshotDigest) {
		t.Fatalf("snapshot identity = %#v", snapshot)
	}
	if len(snapshot.ConnectionGrants) != 1 {
		t.Fatal("missing connection grant")
	}
	headers := snapshot.ConnectionGrants[0].Headers
	if headers["X-MCP-Resource-Grant"] == "" || headers["X-Auth-User-ID"] != "" || headers["X-Project-ID"] != "" {
		t.Fatal("expected opaque resource grant without product identity")
	}
	if got := repository.installations[installationKey("tenant", "workspace", manifest.ID)].EncryptedSecrets["access_token"]; got != "enc:Bearer secret" {
		t.Fatalf("persisted secret = %q", got)
	}
	if snapshot.ConnectionGrants[0].Headers["Authorization"] == installed.EncryptedSecrets["access_token"] {
		t.Fatal("resolve returned encrypted storage value instead of an in-memory connection grant")
	}
}

func TestAgentPluginSelectionOptionsUseInstalledReleaseAndExposeOnlySelectionPolicy(t *testing.T) {
	service, _, installedRelease := testAgentPluginService(t)
	actor := Actor{UserID: "user", TenantID: "tenant", WorkspaceID: "workspace", WorkspaceRole: "workspace_admin"}
	installedRelease.MCPServers[0].RequiredBindings = nil
	installedRelease.MCPServers[0].BindingHeaders = nil
	installedRelease.Digest = ""
	installedRelease, err := SealAgentPluginManifest(installedRelease)
	if err != nil {
		t.Fatal(err)
	}
	if err = service.ReconcileSystemReleases(context.Background(), []AgentPluginReleaseSeed{{
		Catalog: domain.AgentPluginCatalogEntry{
			ID: installedRelease.ID, DisplayName: installedRelease.DisplayName, Description: installedRelease.Description,
			Source: installedRelease.Source, Trust: installedRelease.Trust, InstallPolicy: domain.AgentPluginInstalledByDefault,
			Availability: "available", Listed: true,
		},
		Manifest: installedRelease,
	}}); err != nil {
		t.Fatal(err)
	}
	if _, err = service.Install(context.Background(), actor, InstallAgentPluginInput{
		PluginID: installedRelease.ID, Enabled: true, Secrets: map[string]string{"access_token": "secret"},
	}); err != nil {
		t.Fatal(err)
	}

	latestRelease := installedRelease
	latestRelease.MCPServers = append([]domain.AgentPluginMCPServer(nil), installedRelease.MCPServers...)
	latestRelease.Version = "2.0.0"
	latestRelease.Description = "A later release requiring a product binding."
	latestRelease.MCPServers[0].RequiredBindings = []string{"canvas_id"}
	latestRelease.MCPServers[0].BindingHeaders = map[string]string{"X-Canvas-ID": "canvas_id"}
	latestRelease.Digest = ""
	latestRelease, err = SealAgentPluginManifest(latestRelease)
	if err != nil {
		t.Fatal(err)
	}
	if err = service.ReconcileSystemReleases(context.Background(), []AgentPluginReleaseSeed{{
		Catalog: domain.AgentPluginCatalogEntry{
			ID: latestRelease.ID, DisplayName: latestRelease.DisplayName, Description: latestRelease.Description,
			Source: latestRelease.Source, Trust: latestRelease.Trust, InstallPolicy: domain.AgentPluginInstalledByDefault,
			Availability: "available", Listed: true,
		},
		Manifest: latestRelease,
	}}); err != nil {
		t.Fatal(err)
	}

	options, err := service.ListSelectionOptions(context.Background(), actor)
	if err != nil {
		t.Fatal(err)
	}
	want := []domain.AgentPluginSelectionOption{{
		PluginID: installedRelease.ID, DisplayName: latestRelease.DisplayName, Description: latestRelease.Description,
		SelectedByDefault: true, RequiresBindings: false, CloudOnly: true,
	}}
	if !reflect.DeepEqual(options, want) {
		t.Fatalf("selection options = %#v, want %#v", options, want)
	}
}

func TestAgentPluginInstallIsIdempotentAndEnablementBumpsWorkspaceRevision(t *testing.T) {
	service, _, manifest := testAgentPluginService(t)
	actor := Actor{UserID: "user", TenantID: "tenant", WorkspaceID: "workspace", WorkspaceRole: "workspace_admin"}
	input := InstallAgentPluginInput{PluginID: manifest.ID, Enabled: true, Secrets: map[string]string{"access_token": "Bearer secret"}}
	first, err := service.Install(context.Background(), actor, input)
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.Install(context.Background(), actor, input)
	if err != nil {
		t.Fatal(err)
	}
	if first.Revision != second.Revision {
		t.Fatalf("idempotent install changed revision from %d to %d", first.Revision, second.Revision)
	}
	disabled, err := service.SetEnabled(context.Background(), actor, manifest.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	if disabled.Revision != first.Revision+1 || disabled.Enabled {
		t.Fatalf("disabled = %#v", disabled)
	}
	if _, err = service.Resolve(context.Background(), actor, []domain.AgentPluginActivation{{PluginID: manifest.ID}}); err == nil {
		t.Fatal("disabled plugin was resolved")
	}
}

func TestAgentPluginResolveRejectsCrossWorkspaceMissingBindingsAndServerCollision(t *testing.T) {
	service, _, manifest := testAgentPluginService(t)
	admin := Actor{UserID: "user", TenantID: "tenant", WorkspaceID: "workspace", WorkspaceRole: "workspace_admin"}
	if _, err := service.Install(context.Background(), admin, InstallAgentPluginInput{PluginID: manifest.ID, Enabled: true, Secrets: map[string]string{"access_token": "secret"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Resolve(context.Background(), admin, []domain.AgentPluginActivation{{PluginID: manifest.ID}}); err == nil {
		t.Fatal("missing required bindings were accepted")
	}
	otherWorkspace := admin
	otherWorkspace.WorkspaceID = "other"
	if _, err := service.Resolve(context.Background(), otherWorkspace, []domain.AgentPluginActivation{{PluginID: manifest.ID, Bindings: map[string]string{"project_id": "p", "canvas_id": "c"}}}); err == nil {
		t.Fatal("installation leaked across workspaces")
	}
	second := testAgentPluginManifest(t, "other@platform", "canvas")
	if err := service.ReconcileSystemReleases(context.Background(), []AgentPluginReleaseSeed{{Catalog: domain.AgentPluginCatalogEntry{
		ID: second.ID, DisplayName: second.DisplayName, Description: second.Description, Source: second.Source, Trust: second.Trust,
		InstallPolicy: domain.AgentPluginAvailable, Availability: "available", Listed: true,
	}, Manifest: second}}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Install(context.Background(), admin, InstallAgentPluginInput{PluginID: second.ID, Enabled: true, Secrets: map[string]string{"access_token": "secret"}}); err != nil {
		t.Fatal(err)
	}
	bindings := map[string]string{"project_id": "p", "canvas_id": "c"}
	if _, err := service.Resolve(context.Background(), admin, []domain.AgentPluginActivation{{PluginID: manifest.ID, Bindings: bindings}, {PluginID: second.ID, Bindings: bindings}}); err == nil {
		t.Fatal("two selected plugins contributed the same MCP server namespace")
	}
}

func TestAgentPluginManifestRejectsTrustElevationAndDigestMutation(t *testing.T) {
	manifest := testAgentPluginManifest(t, "external@example", "external")
	manifest.Source = domain.AgentPluginSourceExternalMCP
	if _, err := SealAgentPluginManifest(manifest); err == nil {
		t.Fatal("external MCP plugin claimed system trust")
	}
	manifest = testAgentPluginManifest(t, "canvas@platform", "canvas")
	manifest.Description = "mutated after publication"
	if err := ValidateAgentPluginManifest(manifest); err == nil {
		t.Fatal("mutated immutable release retained its old digest")
	}
	manifest = testAgentPluginManifest(t, "canvas@platform", "canvas")
	manifest.Digest = ""
	manifest.MCPServers[0].ConfigHeaders = map[string]string{"X-Caller-Service": "caller_service"}
	if _, err := SealAgentPluginManifest(manifest); err == nil {
		t.Fatal("manifest was allowed to override a trusted connection grant header")
	}
	manifest = testAgentPluginManifest(t, "canvas@platform", "canvas")
	manifest.Digest = ""
	manifest.MCPServers[0].SecretHeaders = map[string]string{"X-Internal-Token": "runtime_token"}
	if _, err := SealAgentPluginManifest(manifest); err == nil {
		t.Fatal("manifest was allowed to source the workload credential from plugin secrets")
	}
	manifest = testAgentPluginManifest(t, "canvas@platform", "canvas")
	manifest.Digest = ""
	manifest.MCPServers[0].ConfigHeaders = map[string]string{"X-Runtime-Scope-Credential": "credential"}
	if _, err := SealAgentPluginManifest(manifest); err == nil {
		t.Fatal("manifest was allowed to override the Runtime-bound scope credential")
	}
}

func TestAgentPluginResolveRequiresWorkspaceRole(t *testing.T) {
	service, _, manifest := testAgentPluginService(t)
	actor := Actor{UserID: "user", TenantID: "tenant", WorkspaceID: "workspace", WorkspaceRole: "workspace_admin"}
	if _, err := service.Install(context.Background(), actor, InstallAgentPluginInput{
		PluginID: manifest.ID, Enabled: true, Secrets: map[string]string{"access_token": "secret"},
	}); err != nil {
		t.Fatal(err)
	}
	actor.WorkspaceRole = ""
	if _, err := service.Resolve(context.Background(), actor, []domain.AgentPluginActivation{{
		PluginID: manifest.ID, Bindings: map[string]string{"project_id": "p", "canvas_id": "c"},
	}}); err == nil {
		t.Fatal("plugin resolution accepted an empty workspace role")
	}
}

func TestExternalAgentPluginPublicationRequiresSuperAdminAndNeverInstalls(t *testing.T) {
	repository := newPluginTestRepository()
	service := NewAgentPluginService(repository, pluginTestCipher{}, pluginTestErrors{})
	manifest := testAgentPluginManifest(t, "search@example", "search")
	manifest.Source = domain.AgentPluginSourceExternalMCP
	manifest.Trust = domain.AgentPluginTrustUnverified
	manifest.Digest = ""
	manifest.MCPServers[0].Tools[0].Policy.Trust = "open-world"
	input := PublishAgentPluginInput{
		Manifest: manifest, InstallPolicy: domain.AgentPluginAvailable, Availability: "available", Listed: true,
	}
	if _, _, err := service.PublishRelease(context.Background(), Actor{}, input); err == nil {
		t.Fatal("non-super-admin published an external plugin")
	}
	catalog, release, err := service.PublishRelease(context.Background(), Actor{Roles: map[string]bool{"super_admin": true}}, input)
	if err != nil {
		t.Fatal(err)
	}
	if catalog.LatestReleaseDigest != release.Digest || !digestPattern.MatchString(release.Digest) {
		t.Fatalf("catalog = %#v, release = %#v", catalog, release)
	}
	if len(repository.installations) != 0 {
		t.Fatal("publishing a catalog resource implicitly installed it")
	}
	workspaceAdmin := Actor{UserID: "user", TenantID: "tenant", WorkspaceID: "workspace", WorkspaceRole: "workspace_admin"}
	if _, err = service.Install(context.Background(), workspaceAdmin, InstallAgentPluginInput{
		PluginID: release.ID, Enabled: true, Secrets: map[string]string{"access_token": "Bearer external"},
	}); err != nil {
		t.Fatal(err)
	}
	resolved, err := service.Resolve(context.Background(), workspaceAdmin, []domain.AgentPluginActivation{{
		PluginID: release.ID, Bindings: map[string]string{"project_id": "project", "canvas_id": "canvas"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	for header := range resolved.ConnectionGrants[0].Headers {
		if strings.HasPrefix(strings.ToLower(header), "x-auth-") || strings.EqualFold(header, "X-Caller-Service") {
			t.Fatalf("external MCP received internal identity header %s", header)
		}
	}
}

func TestAgentPluginUninstallIsIdempotentAndRemovesResolution(t *testing.T) {
	service, _, manifest := testAgentPluginService(t)
	actor := Actor{UserID: "user", TenantID: "tenant", WorkspaceID: "workspace", WorkspaceRole: "workspace_admin"}
	if _, err := service.Install(context.Background(), actor, InstallAgentPluginInput{PluginID: manifest.ID, Enabled: true, Secrets: map[string]string{"access_token": "secret"}}); err != nil {
		t.Fatal(err)
	}
	if err := service.Uninstall(context.Background(), actor, manifest.ID); err != nil {
		t.Fatal(err)
	}
	if err := service.Uninstall(context.Background(), actor, manifest.ID); err != nil {
		t.Fatalf("idempotent uninstall: %v", err)
	}
	if _, err := service.Resolve(context.Background(), actor, []domain.AgentPluginActivation{{PluginID: manifest.ID, Bindings: map[string]string{"project_id": "p", "canvas_id": "c"}}}); err == nil {
		t.Fatal("uninstalled plugin was resolved")
	}
}

func TestImmutableReleaseSurvivesJSONBKeyReordering(t *testing.T) {
	manifest := testAgentPluginManifest(t, "canvas@platform", "canvas")
	manifest.MCPServers[0].Tools[0].InputSchema = json.RawMessage(`{"additionalProperties": false, "type": "object", "properties": {}}`)
	if err := ValidateAgentPluginManifest(manifest); err != nil {
		t.Fatal(err)
	}
}
