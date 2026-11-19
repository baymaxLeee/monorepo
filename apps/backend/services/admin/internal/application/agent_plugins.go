package application

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/example/monorepo/admin/internal/domain"
	"github.com/google/uuid"
)

const maxActiveAgentPlugins = 16

var (
	pluginComponentPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$`)
	serverNamePattern      = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$`)
	bindingKeyPattern      = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)
	toolNamePattern        = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	headerNamePattern      = regexp.MustCompile(`^[!#$%&'*+.^_` + "`" + `|~0-9A-Za-z-]+$`)
	digestPattern          = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
	sha256Pattern          = regexp.MustCompile(`^[0-9a-f]{64}$`)
	semverPattern          = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$`)
)

type AgentPluginReleaseSeed struct {
	Catalog  domain.AgentPluginCatalogEntry
	Manifest domain.AgentPluginManifest
}

type InstallAgentPluginInput struct {
	PluginID      string
	ReleaseDigest string
	Enabled       bool
	Config        map[string]string
	Secrets       map[string]string
}

type PublishAgentPluginInput struct {
	Manifest      domain.AgentPluginManifest
	InstallPolicy domain.AgentPluginInstallPolicy
	Availability  string
	Listed        bool
}

type AgentPluginService struct {
	Repository AgentPluginRepository
	Keys       SecretCipher
	Errors     ErrorClassifier
	Now        func() time.Time
	NewID      func() string
}

func NewAgentPluginService(repository AgentPluginRepository, keys SecretCipher, errors ErrorClassifier) AgentPluginService {
	return AgentPluginService{
		Repository: repository,
		Keys:       keys,
		Errors:     errors,
		Now:        func() time.Time { return time.Now().UTC() },
		NewID:      uuid.NewString,
	}
}

// SealAgentPluginManifest publishes an immutable digest-addressed release.
func SealAgentPluginManifest(manifest domain.AgentPluginManifest) (domain.AgentPluginManifest, error) {
	manifest.Digest = ""
	if err := validateManifestContents(manifest); err != nil {
		return domain.AgentPluginManifest{}, err
	}
	digest, err := manifestDigest(manifest)
	if err != nil {
		return domain.AgentPluginManifest{}, err
	}
	manifest.Digest = digest
	return manifest, nil
}

func ValidateAgentPluginManifest(manifest domain.AgentPluginManifest) error {
	if !digestPattern.MatchString(manifest.Digest) {
		return fmt.Errorf("agent plugin %s has an invalid release digest", manifest.ID)
	}
	if err := validateManifestContents(manifest); err != nil {
		return err
	}
	want, err := manifestDigest(manifest)
	if err != nil {
		return err
	}
	if manifest.Digest != want {
		return fmt.Errorf("agent plugin %s release digest does not match its manifest", manifest.ID)
	}
	return nil
}

// ReconcileSystemReleases makes built-in resources available in Admin. It does not load or
// connect any plugin; Runtime/Desktop remain the only execution hosts.
func (s AgentPluginService) ReconcileSystemReleases(ctx context.Context, seeds []AgentPluginReleaseSeed) error {
	seen := make(map[string]bool, len(seeds))
	for _, seed := range seeds {
		if seed.Manifest.Source != domain.AgentPluginSourceSystem || seed.Manifest.Trust != domain.AgentPluginTrustSystem {
			return fmt.Errorf("built-in agent plugin %s must be a system-trust system release", seed.Manifest.ID)
		}
		if err := ValidateAgentPluginManifest(seed.Manifest); err != nil {
			return err
		}
		if seen[seed.Manifest.ID] {
			return fmt.Errorf("duplicate built-in agent plugin %s", seed.Manifest.ID)
		}
		seen[seed.Manifest.ID] = true
		if seed.Catalog.ID != seed.Manifest.ID || seed.Catalog.Source != seed.Manifest.Source || seed.Catalog.Trust != seed.Manifest.Trust {
			return fmt.Errorf("agent plugin %s catalog metadata does not match its release", seed.Manifest.ID)
		}
		if err := validateCatalogEntry(seed.Catalog); err != nil {
			return err
		}
		seed.Catalog.LatestReleaseDigest = seed.Manifest.Digest
		if err := s.Repository.Transaction(ctx, func(repository AgentPluginRepository) error {
			if err := repository.UpsertCatalogEntry(ctx, seed.Catalog); err != nil {
				return err
			}
			existing, err := repository.GetRelease(ctx, seed.Manifest.ID, seed.Manifest.Digest)
			if err != nil && !s.isNotFound(err) {
				return err
			}
			if err == nil {
				if !reflect.DeepEqual(existing, seed.Manifest) {
					return fmt.Errorf("immutable agent plugin release %s/%s changed", seed.Manifest.ID, seed.Manifest.Digest)
				}
			} else if err = repository.CreateRelease(ctx, seed.Manifest); err != nil {
				return err
			}
			return nil
		}); err != nil {
			return err
		}
	}
	return nil
}

// PublishRelease records a reviewed immutable release. Publishing is resource governance only:
// it never contacts the MCP endpoint or activates the plugin for a workspace. System releases
// may be entered manually by a super-admin when deployment-time seeding is intentionally absent.
func (s AgentPluginService) PublishRelease(ctx context.Context, actor Actor, input PublishAgentPluginInput) (domain.AgentPluginCatalogEntry, domain.AgentPluginManifest, error) {
	if !actor.IsSuperAdmin() {
		return domain.AgentPluginCatalogEntry{}, domain.AgentPluginManifest{}, Forbidden("super_admin role required")
	}
	manifest, err := SealAgentPluginManifest(input.Manifest)
	if err != nil {
		return domain.AgentPluginCatalogEntry{}, domain.AgentPluginManifest{}, BadRequestf("invalid agent plugin manifest: %v", err)
	}
	catalog := domain.AgentPluginCatalogEntry{
		ID: manifest.ID, DisplayName: manifest.DisplayName, Description: manifest.Description,
		Source: manifest.Source, Trust: manifest.Trust, InstallPolicy: input.InstallPolicy,
		Availability: input.Availability, LatestReleaseDigest: manifest.Digest, Listed: input.Listed,
	}
	if err = validateCatalogEntry(catalog); err != nil {
		return domain.AgentPluginCatalogEntry{}, domain.AgentPluginManifest{}, BadRequestf("invalid agent plugin catalog entry: %v", err)
	}
	err = s.Repository.Transaction(ctx, func(repository AgentPluginRepository) error {
		if err := repository.UpsertCatalogEntry(ctx, catalog); err != nil {
			return err
		}
		existing, getErr := repository.GetRelease(ctx, manifest.ID, manifest.Digest)
		if getErr != nil && !s.isNotFound(getErr) {
			return getErr
		}
		if getErr == nil {
			if !reflect.DeepEqual(existing, manifest) {
				return fmt.Errorf("immutable agent plugin release %s/%s changed", manifest.ID, manifest.Digest)
			}
			return nil
		}
		return repository.CreateRelease(ctx, manifest)
	})
	if err != nil {
		return domain.AgentPluginCatalogEntry{}, domain.AgentPluginManifest{}, err
	}
	return catalog, manifest, nil
}

func (s AgentPluginService) List(ctx context.Context, actor Actor) ([]domain.AgentPluginListItem, error) {
	if err := requireAgentPluginScope(actor, false); err != nil {
		return nil, err
	}
	return s.Repository.ListCatalog(ctx, actor.TenantID, actor.WorkspaceID)
}

func (s AgentPluginService) ListSelectionOptions(ctx context.Context, actor Actor) ([]domain.AgentPluginSelectionOption, error) {
	if err := requireAgentPluginScope(actor, false); err != nil {
		return nil, err
	}
	candidates, err := s.Repository.ListPluginSelectionCandidates(ctx, actor.TenantID, actor.WorkspaceID)
	if err != nil {
		return nil, err
	}
	result := make([]domain.AgentPluginSelectionOption, 0, len(candidates))
	for _, candidate := range candidates {
		requiresBindings := false
		for _, server := range candidate.Manifest.MCPServers {
			if len(server.RequiredBindings) > 0 {
				requiresBindings = true
				break
			}
		}
		result = append(result, domain.AgentPluginSelectionOption{
			PluginID: candidate.PluginID, DisplayName: candidate.DisplayName, Description: candidate.Description,
			SelectedByDefault: candidate.InstallPolicy == domain.AgentPluginInstalledByDefault && !requiresBindings,
			RequiresBindings:  requiresBindings,
		})
	}
	return result, nil
}

func (s AgentPluginService) Install(ctx context.Context, actor Actor, input InstallAgentPluginInput) (domain.AgentPluginInstallation, error) {
	if err := requireAgentPluginScope(actor, true); err != nil {
		return domain.AgentPluginInstallation{}, err
	}
	if err := RequireWorkspaceAdmin(actor); err != nil {
		return domain.AgentPluginInstallation{}, err
	}
	var result domain.AgentPluginInstallation
	err := s.Repository.Transaction(ctx, func(repository AgentPluginRepository) error {
		catalog, err := repository.GetCatalogEntry(ctx, input.PluginID)
		if err != nil {
			return s.catalogError(input.PluginID, err)
		}
		if !catalog.Listed || catalog.Availability != "available" || catalog.InstallPolicy == domain.AgentPluginNotAvailable {
			return Forbidden("agent plugin is not available in this workspace")
		}
		digest := input.ReleaseDigest
		if digest == "" {
			digest = catalog.LatestReleaseDigest
		}
		manifest, err := repository.GetRelease(ctx, input.PluginID, digest)
		if err != nil {
			return s.releaseError(input.PluginID, digest, err)
		}
		if err = ValidateAgentPluginManifest(manifest); err != nil {
			return fmt.Errorf("stored agent plugin release is invalid: %w", err)
		}
		if err = validateInstallationValues(manifest, input.Config, input.Secrets); err != nil {
			return err
		}
		if _, err = repository.WorkspaceRevision(ctx, actor.TenantID, actor.WorkspaceID, true); err != nil {
			return err
		}
		existing, getErr := repository.GetInstallation(ctx, actor.TenantID, actor.WorkspaceID, input.PluginID)
		if getErr != nil && !s.isNotFound(getErr) {
			return getErr
		}
		if getErr == nil {
			sameSecrets, err := s.secretsEqual(existing.EncryptedSecrets, input.Secrets)
			if err != nil {
				return err
			}
			if existing.ReleaseDigest == digest && existing.Enabled == input.Enabled && stringMapsEqual(existing.Config, input.Config) && sameSecrets {
				result = existing
				return nil
			}
		}
		encryptedSecrets, err := s.encryptSecrets(input.Secrets)
		if err != nil {
			return err
		}
		now := s.now()
		revision, err := repository.BumpWorkspaceRevision(ctx, actor.TenantID, actor.WorkspaceID, now)
		if err != nil {
			return err
		}
		result = domain.AgentPluginInstallation{
			TenantID: actor.TenantID, WorkspaceID: actor.WorkspaceID, PluginID: input.PluginID,
			ReleaseDigest: digest, Enabled: input.Enabled, Revision: revision,
			Config: cloneStringMap(input.Config), EncryptedSecrets: encryptedSecrets,
			InstalledBy: actor.UserID, UpdatedBy: actor.UserID, CreatedAt: now, UpdatedAt: now,
		}
		if getErr == nil {
			result.InstalledBy = existing.InstalledBy
			result.CreatedAt = existing.CreatedAt
		}
		return repository.SaveInstallation(ctx, result)
	})
	return result, err
}

func (s AgentPluginService) SetEnabled(ctx context.Context, actor Actor, pluginID string, enabled bool) (domain.AgentPluginInstallation, error) {
	if err := requireAgentPluginScope(actor, true); err != nil {
		return domain.AgentPluginInstallation{}, err
	}
	if err := RequireWorkspaceAdmin(actor); err != nil {
		return domain.AgentPluginInstallation{}, err
	}
	var result domain.AgentPluginInstallation
	err := s.Repository.Transaction(ctx, func(repository AgentPluginRepository) error {
		if _, err := repository.WorkspaceRevision(ctx, actor.TenantID, actor.WorkspaceID, true); err != nil {
			return err
		}
		installation, err := repository.GetInstallation(ctx, actor.TenantID, actor.WorkspaceID, pluginID)
		if err != nil {
			return s.installationError(pluginID, err)
		}
		if installation.Enabled == enabled {
			result = installation
			return nil
		}
		now := s.now()
		installation.Revision, err = repository.BumpWorkspaceRevision(ctx, actor.TenantID, actor.WorkspaceID, now)
		if err != nil {
			return err
		}
		installation.Enabled = enabled
		installation.UpdatedBy = actor.UserID
		installation.UpdatedAt = now
		if err = repository.SaveInstallation(ctx, installation); err != nil {
			return err
		}
		result = installation
		return nil
	})
	return result, err
}

func (s AgentPluginService) Uninstall(ctx context.Context, actor Actor, pluginID string) error {
	if err := requireAgentPluginScope(actor, true); err != nil {
		return err
	}
	if err := RequireWorkspaceAdmin(actor); err != nil {
		return err
	}
	return s.Repository.Transaction(ctx, func(repository AgentPluginRepository) error {
		if _, err := repository.WorkspaceRevision(ctx, actor.TenantID, actor.WorkspaceID, true); err != nil {
			return err
		}
		deleted, err := repository.DeleteInstallation(ctx, actor.TenantID, actor.WorkspaceID, pluginID)
		if err != nil || !deleted {
			return err
		}
		_, err = repository.BumpWorkspaceRevision(ctx, actor.TenantID, actor.WorkspaceID, s.now())
		return err
	})
}

func (s AgentPluginService) Resolve(ctx context.Context, actor Actor, activations []domain.AgentPluginActivation) (domain.ResolvedAgentPluginSnapshot, error) {
	if err := requireAgentPluginScope(actor, true); err != nil {
		return domain.ResolvedAgentPluginSnapshot{}, err
	}
	if !validHeaderValue(actor.WorkspaceRole) {
		return domain.ResolvedAgentPluginSnapshot{}, BadRequest("workspace role is required")
	}
	if len(activations) > maxActiveAgentPlugins {
		return domain.ResolvedAgentPluginSnapshot{}, BadRequestf("at most %d agent plugins may be activated", maxActiveAgentPlugins)
	}
	seen := make(map[string]bool, len(activations))
	serverOwners := map[string]string{}
	resolved := make([]domain.ResolvedAgentPlugin, 0, len(activations))
	grants := make([]domain.AgentPluginConnectionGrant, 0, len(activations))
	var workspaceRevision int64
	err := s.Repository.Transaction(ctx, func(repository AgentPluginRepository) error {
		var err error
		workspaceRevision, err = repository.WorkspaceRevision(ctx, actor.TenantID, actor.WorkspaceID, true)
		if err != nil {
			return err
		}
		for _, activation := range activations {
			if seen[activation.PluginID] {
				return BadRequestf("agent plugin %s was activated more than once", activation.PluginID)
			}
			seen[activation.PluginID] = true
			installation, err := repository.GetInstallation(ctx, actor.TenantID, actor.WorkspaceID, activation.PluginID)
			if err != nil {
				return s.installationError(activation.PluginID, err)
			}
			if !installation.Enabled {
				return Forbidden("agent plugin is disabled in this workspace")
			}
			catalog, err := repository.GetCatalogEntry(ctx, activation.PluginID)
			if err != nil {
				return s.catalogError(activation.PluginID, err)
			}
			if !catalog.Listed || catalog.Availability != "available" || catalog.InstallPolicy == domain.AgentPluginNotAvailable {
				return Forbidden("agent plugin is not available in this workspace")
			}
			manifest, err := repository.GetRelease(ctx, activation.PluginID, installation.ReleaseDigest)
			if err != nil {
				return s.releaseError(activation.PluginID, installation.ReleaseDigest, err)
			}
			if err = ValidateAgentPluginManifest(manifest); err != nil {
				return fmt.Errorf("stored agent plugin release is invalid: %w", err)
			}
			if err = validateActivation(manifest, activation); err != nil {
				return err
			}
			secrets, err := s.decryptSecrets(installation.EncryptedSecrets)
			if err != nil {
				return err
			}
			for _, server := range manifest.MCPServers {
				if owner := serverOwners[server.Name]; owner != "" {
					return BadRequestf("MCP server %s is contributed by both %s and %s", server.Name, owner, manifest.ID)
				}
				serverOwners[server.Name] = manifest.ID
				headers, err := resolveHeaders(server, activation.Bindings, installation.Config, secrets)
				if err != nil {
					return err
				}
				if manifest.Source == domain.AgentPluginSourceSystem && manifest.Trust == domain.AgentPluginTrustSystem {
					headers["X-Auth-User-ID"] = actor.UserID
					headers["X-Auth-Tenant-ID"] = actor.TenantID
					headers["X-Auth-Workspace-ID"] = actor.WorkspaceID
					headers["X-Auth-Workspace-Role"] = actor.WorkspaceRole
					headers["X-Caller-Service"] = "runtime"
				}
				grants = append(grants, domain.AgentPluginConnectionGrant{PluginID: manifest.ID, ServerName: server.Name, Headers: headers})
			}
			resolved = append(resolved, domain.ResolvedAgentPlugin{Manifest: manifest, Activation: activation})
		}
		return nil
	})
	if err != nil {
		return domain.ResolvedAgentPluginSnapshot{}, err
	}
	resolvedAt := s.now()
	snapshot := domain.ResolvedAgentPluginSnapshot{
		SchemaVersion: 1, SnapshotID: s.newID(), WorkspaceRevision: workspaceRevision,
		TenantID: actor.TenantID, WorkspaceID: actor.WorkspaceID, ResolvedAt: resolvedAt,
		Plugins: resolved, ConnectionGrants: grants,
	}
	digest, err := snapshotDigest(snapshot)
	if err != nil {
		return domain.ResolvedAgentPluginSnapshot{}, err
	}
	snapshot.SnapshotDigest = digest
	return snapshot, nil
}

func validateCatalogEntry(entry domain.AgentPluginCatalogEntry) error {
	if err := validatePluginID(entry.ID); err != nil {
		return err
	}
	if strings.TrimSpace(entry.DisplayName) == "" || strings.TrimSpace(entry.Description) == "" {
		return fmt.Errorf("agent plugin %s has incomplete catalog metadata", entry.ID)
	}
	if entry.Availability != "available" && entry.Availability != "unavailable" {
		return fmt.Errorf("agent plugin %s has invalid availability", entry.ID)
	}
	switch entry.InstallPolicy {
	case domain.AgentPluginAvailable, domain.AgentPluginInstalledByDefault, domain.AgentPluginNotAvailable:
	default:
		return fmt.Errorf("agent plugin %s has invalid install policy", entry.ID)
	}
	return nil
}

func validateManifestContents(manifest domain.AgentPluginManifest) error {
	if err := validatePluginID(manifest.ID); err != nil {
		return err
	}
	if manifest.SchemaVersion != 1 || !semverPattern.MatchString(manifest.Version) {
		return fmt.Errorf("agent plugin %s has an invalid immutable release identity", manifest.ID)
	}
	if strings.TrimSpace(manifest.DisplayName) == "" || strings.TrimSpace(manifest.Description) == "" {
		return fmt.Errorf("agent plugin %s has incomplete display metadata", manifest.ID)
	}
	switch manifest.Source {
	case domain.AgentPluginSourceSystem:
		if manifest.Trust != domain.AgentPluginTrustSystem {
			return fmt.Errorf("system agent plugin %s must use system trust", manifest.ID)
		}
	case domain.AgentPluginSourceExternalMCP:
		if manifest.Trust == domain.AgentPluginTrustSystem {
			return fmt.Errorf("external agent plugin %s cannot claim system trust", manifest.ID)
		}
	default:
		return fmt.Errorf("agent plugin %s has an invalid source", manifest.ID)
	}
	if len(manifest.MCPServers) == 0 && len(manifest.Skills) == 0 {
		return fmt.Errorf("agent plugin %s contributes no capabilities", manifest.ID)
	}
	serverNames := map[string]bool{}
	for _, server := range manifest.MCPServers {
		if !serverNamePattern.MatchString(server.Name) || serverNames[server.Name] || len(server.Tools) == 0 {
			return fmt.Errorf("agent plugin %s has an invalid MCP server manifest", manifest.ID)
		}
		serverNames[server.Name] = true
		endpoint, err := url.Parse(server.URL)
		if err != nil || endpoint.Host == "" || endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" || endpoint.Scheme != "http" && endpoint.Scheme != "https" {
			return fmt.Errorf("agent plugin %s MCP endpoint must be a fixed HTTP URL", manifest.ID)
		}
		bindings := append(append([]string(nil), server.RequiredBindings...), server.OptionalBindings...)
		if err = uniqueValid("binding", bindings, bindingKeyPattern.MatchString); err != nil {
			return fmt.Errorf("agent plugin %s MCP server %s: %w", manifest.ID, server.Name, err)
		}
		declaredBindings := make(map[string]bool, len(bindings))
		for _, key := range bindings {
			declaredBindings[key] = true
		}
		if err = validateHeaderMappings(server, declaredBindings); err != nil {
			return fmt.Errorf("agent plugin %s MCP server %s: %w", manifest.ID, server.Name, err)
		}
		toolNames := map[string]bool{}
		for _, tool := range server.Tools {
			if !toolNamePattern.MatchString(tool.Name) || toolNames[tool.Name] || strings.TrimSpace(tool.Description) == "" || strings.TrimSpace(tool.Planning.Summary) == "" {
				return fmt.Errorf("agent plugin %s has incomplete or duplicate MCP tool metadata", manifest.ID)
			}
			toolNames[tool.Name] = true
			if err = validateJSONObject(tool.InputSchema); err != nil {
				return fmt.Errorf("agent plugin %s tool %s input schema: %w", manifest.ID, tool.Name, err)
			}
			if len(tool.OutputSchema) > 0 {
				if err = validateJSONObject(tool.OutputSchema); err != nil {
					return fmt.Errorf("agent plugin %s tool %s output schema: %w", manifest.ID, tool.Name, err)
				}
			}
			if err = validateToolPolicy(manifest, tool.Policy); err != nil {
				return fmt.Errorf("agent plugin %s tool %s: %w", manifest.ID, tool.Name, err)
			}
		}
	}
	skillIDs := map[string]bool{}
	for _, skill := range manifest.Skills {
		if skill.ID == "" || skillIDs[skill.ID] || strings.TrimSpace(skill.Name) == "" || strings.TrimSpace(skill.Description) == "" || skill.AssetID == "" || skill.RevisionID == "" || !sha256Pattern.MatchString(skill.SHA256) {
			return fmt.Errorf("agent plugin %s has an invalid skill contribution", manifest.ID)
		}
		skillIDs[skill.ID] = true
	}
	return nil
}

func validateHeaderMappings(server domain.AgentPluginMCPServer, bindings map[string]bool) error {
	seenHeaders := map[string]bool{}
	for kind, mapping := range map[string]map[string]string{
		"binding": server.BindingHeaders,
		"config":  server.ConfigHeaders,
		"secret":  server.SecretHeaders,
	} {
		for header, key := range mapping {
			canonical := strings.ToLower(header)
			if reservedGrantHeader(canonical) || !headerNamePattern.MatchString(header) || seenHeaders[canonical] || !bindingKeyPattern.MatchString(key) {
				return fmt.Errorf("invalid or duplicate %s header mapping", kind)
			}
			if kind == "binding" && !bindings[key] {
				return fmt.Errorf("binding header references undeclared binding %s", key)
			}
			seenHeaders[canonical] = true
		}
	}
	return nil
}

func reservedGrantHeader(canonical string) bool {
	return strings.HasPrefix(canonical, "x-auth-") || canonical == "x-caller-service" || canonical == "x-internal-token" ||
		canonical == "x-runtime-turn-id" || canonical == "x-runtime-attempt-epoch" ||
		canonical == "x-runtime-scope-credential"
}

func validateToolPolicy(manifest domain.AgentPluginManifest, policy domain.AgentPluginToolPolicy) error {
	if !oneOf(policy.Capability, "search", "files", "planning", "interaction", "media", "memory", "external") ||
		!oneOf(policy.Effect, "read", "write", "add", "update", "destructive", "none", "unknown") ||
		!oneOf(policy.Trust, "closed", "private-untrusted", "open-world", "unknown") ||
		!oneOf(policy.Execution, "client", "inline", "durable") {
		return fmt.Errorf("invalid tool policy")
	}
	if manifest.Trust != domain.AgentPluginTrustSystem && policy.Trust == "closed" {
		return fmt.Errorf("non-system plugin cannot publish a closed-trust tool")
	}
	if policy.UIKind != "" && !oneOf(policy.UIKind, "artifact", "ask-user", "image-gallery", "todo-list", "video", "terminal", "subagent") {
		return fmt.Errorf("invalid tool UI kind")
	}
	return nil
}

func validateInstallationValues(manifest domain.AgentPluginManifest, config, secrets map[string]string) error {
	requiredConfig := map[string]bool{}
	requiredSecrets := map[string]bool{}
	for _, server := range manifest.MCPServers {
		for _, key := range server.ConfigHeaders {
			requiredConfig[key] = true
		}
		for _, key := range server.SecretHeaders {
			requiredSecrets[key] = true
		}
	}
	if err := validateExactValues("config", requiredConfig, config); err != nil {
		return BadRequestf("agent plugin %s %s", manifest.ID, err)
	}
	if err := validateExactValues("secret", requiredSecrets, secrets); err != nil {
		return BadRequestf("agent plugin %s %s", manifest.ID, err)
	}
	return nil
}

func validateExactValues(kind string, required map[string]bool, values map[string]string) error {
	for key := range required {
		if !validHeaderValue(values[key]) {
			return fmt.Errorf("requires %s %s", kind, key)
		}
	}
	for key, value := range values {
		if !required[key] {
			return fmt.Errorf("does not allow %s %s", kind, key)
		}
		if !validHeaderValue(value) {
			return fmt.Errorf("%s %s is invalid", kind, key)
		}
	}
	return nil
}

func validateActivation(manifest domain.AgentPluginManifest, activation domain.AgentPluginActivation) error {
	if activation.PluginID != manifest.ID {
		return BadRequestf("selected agent plugin %s resolved to %s", activation.PluginID, manifest.ID)
	}
	required := map[string]bool{}
	allowed := map[string]bool{}
	for _, server := range manifest.MCPServers {
		for _, key := range server.RequiredBindings {
			required[key] = true
			allowed[key] = true
		}
		for _, key := range server.OptionalBindings {
			allowed[key] = true
		}
	}
	for key := range required {
		if !validBindingValue(activation.Bindings[key]) {
			return BadRequestf("agent plugin %s requires binding %s", manifest.ID, key)
		}
	}
	for key, value := range activation.Bindings {
		if !allowed[key] {
			return BadRequestf("agent plugin %s does not allow binding %s", manifest.ID, key)
		}
		if !validBindingValue(value) {
			return BadRequestf("agent plugin %s binding %s is invalid", manifest.ID, key)
		}
	}
	return nil
}

func resolveHeaders(server domain.AgentPluginMCPServer, bindings, config, secrets map[string]string) (map[string]string, error) {
	headers := make(map[string]string, len(server.BindingHeaders)+len(server.ConfigHeaders)+len(server.SecretHeaders))
	for header, key := range server.BindingHeaders {
		if value := bindings[key]; value != "" {
			headers[header] = value
		}
	}
	for header, key := range server.ConfigHeaders {
		if value := config[key]; validHeaderValue(value) {
			headers[header] = value
		} else {
			return nil, fmt.Errorf("stored agent plugin config %s is missing or invalid", key)
		}
	}
	for header, key := range server.SecretHeaders {
		if value := secrets[key]; validHeaderValue(value) {
			headers[header] = value
		} else {
			return nil, fmt.Errorf("stored agent plugin secret %s is missing or invalid", key)
		}
	}
	return headers, nil
}

func manifestDigest(manifest domain.AgentPluginManifest) (string, error) {
	manifest.Digest = ""
	raw, err := json.Marshal(manifest)
	if err != nil {
		return "", fmt.Errorf("marshal agent plugin manifest: %w", err)
	}
	hash := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(hash[:]), nil
}

func snapshotDigest(snapshot domain.ResolvedAgentPluginSnapshot) (string, error) {
	persisted := struct {
		SchemaVersion     int                          `json:"schemaVersion"`
		SnapshotID        string                       `json:"snapshotId"`
		WorkspaceRevision int64                        `json:"workspaceRevision"`
		TenantID          string                       `json:"tenantId"`
		WorkspaceID       string                       `json:"workspaceId"`
		ResolvedAt        time.Time                    `json:"resolvedAt"`
		Plugins           []domain.ResolvedAgentPlugin `json:"plugins"`
	}{snapshot.SchemaVersion, snapshot.SnapshotID, snapshot.WorkspaceRevision, snapshot.TenantID, snapshot.WorkspaceID, snapshot.ResolvedAt, snapshot.Plugins}
	raw, err := json.Marshal(persisted)
	if err != nil {
		return "", fmt.Errorf("marshal resolved agent plugin snapshot: %w", err)
	}
	hash := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(hash[:]), nil
}

func validatePluginID(id string) error {
	separator := strings.LastIndex(id, "@")
	if separator <= 0 || separator == len(id)-1 {
		return fmt.Errorf("invalid agent plugin id %q", id)
	}
	parts := []string{id[:separator], id[separator+1:]}
	for _, part := range parts {
		if !pluginComponentPattern.MatchString(part) || strings.Contains(part, "--") || strings.Contains(part, "..") {
			return fmt.Errorf("invalid agent plugin id %q", id)
		}
	}
	return nil
}

func validateJSONObject(raw json.RawMessage) error {
	if len(raw) == 0 || !json.Valid(raw) {
		return fmt.Errorf("must be valid JSON")
	}
	var value map[string]interface{}
	if err := json.Unmarshal(raw, &value); err != nil || value == nil {
		return fmt.Errorf("must be a JSON object")
	}
	return nil
}

func uniqueValid(kind string, values []string, valid func(string) bool) error {
	seen := make(map[string]bool, len(values))
	for _, value := range values {
		if !valid(value) || seen[value] {
			return fmt.Errorf("invalid or duplicate %s %q", kind, value)
		}
		seen[value] = true
	}
	return nil
}

func requireAgentPluginScope(actor Actor, requireUser bool) error {
	if actor.TenantID == "" || actor.WorkspaceID == "" || requireUser && actor.UserID == "" {
		return BadRequest("user and workspace scope are required")
	}
	return nil
}

func validBindingValue(value string) bool {
	return value != "" && len(value) <= 256 && !containsControl(value)
}

func validHeaderValue(value string) bool {
	return value != "" && len(value) <= 8192 && !strings.ContainsAny(value, "\r\n\x00")
}

func containsControl(value string) bool {
	return strings.IndexFunc(value, func(r rune) bool { return unicode.IsControl(r) }) >= 0
}

func oneOf(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}

func cloneStringMap(input map[string]string) map[string]string {
	if len(input) == 0 {
		return map[string]string{}
	}
	result := make(map[string]string, len(input))
	for key, value := range input {
		result[key] = value
	}
	return result
}

func (s AgentPluginService) encryptSecrets(values map[string]string) (map[string]string, error) {
	result := make(map[string]string, len(values))
	keys := sortedKeys(values)
	for _, key := range keys {
		value, err := s.Keys.Encrypt(values[key])
		if err != nil {
			return nil, fmt.Errorf("encrypt agent plugin secret: %w", err)
		}
		result[key] = value
	}
	return result, nil
}

func (s AgentPluginService) decryptSecrets(values map[string]string) (map[string]string, error) {
	result := make(map[string]string, len(values))
	for _, key := range sortedKeys(values) {
		value, err := s.Keys.Decrypt(values[key])
		if err != nil {
			return nil, fmt.Errorf("decrypt agent plugin secret: %w", err)
		}
		result[key] = value
	}
	return result, nil
}

func (s AgentPluginService) secretsEqual(encrypted, plain map[string]string) (bool, error) {
	decrypted, err := s.decryptSecrets(encrypted)
	if err != nil {
		return false, err
	}
	return stringMapsEqual(decrypted, plain), nil
}

func stringMapsEqual(left, right map[string]string) bool {
	if len(left) != len(right) {
		return false
	}
	for key, value := range left {
		if right[key] != value {
			return false
		}
	}
	return true
}

func sortedKeys(values map[string]string) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func (s AgentPluginService) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

func (s AgentPluginService) newID() string {
	if s.NewID != nil {
		return s.NewID()
	}
	return uuid.NewString()
}

func (s AgentPluginService) isNotFound(err error) bool {
	return err != nil && s.Errors != nil && s.Errors.IsNotFound(err)
}

func (s AgentPluginService) catalogError(pluginID string, err error) error {
	if s.isNotFound(err) {
		return NotFound("agent plugin %s not found", pluginID)
	}
	return err
}

func (s AgentPluginService) releaseError(pluginID, digest string, err error) error {
	if s.isNotFound(err) {
		return NotFound("agent plugin release %s/%s not found", pluginID, digest)
	}
	return err
}

func (s AgentPluginService) installationError(pluginID string, err error) error {
	if s.isNotFound(err) {
		return Forbidden(fmt.Sprintf("agent plugin %s is not installed in this workspace", pluginID))
	}
	return err
}
