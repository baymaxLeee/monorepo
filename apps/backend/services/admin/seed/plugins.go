// Package seed owns the reviewed, built-in releases shipped with Admin.
package seed

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"net/url"

	"github.com/example/monorepo/admin/internal/application"
	"github.com/example/monorepo/admin/internal/domain"
)

//go:embed system-plugins.generated.json
var systemPlugins []byte

// PublishPlugins resolves deployment-specific endpoints before sealing both releases.
// Workspace installations and per-conversation activations remain operator/user choices.
func PublishPlugins(ctx context.Context, service application.AgentPluginService, knowledgeURL, canvasURL string) error {
	seeds, err := systemReleases(knowledgeURL, canvasURL)
	if err != nil {
		return err
	}
	return service.Repository.Transaction(ctx, func(repo application.AgentPluginRepository) error {
		for i := range seeds {
			entry, err := repo.GetCatalogEntry(ctx, seeds[i].Manifest.ID)
			if err != nil {
				if service.Errors.IsNotFound(err) {
					continue
				}
				return err
			}
			if entry.Source != domain.AgentPluginSourceSystem || entry.Trust != domain.AgentPluginTrustSystem {
				return fmt.Errorf("built-in plugin ID %s already belongs to another source", entry.ID)
			}
			// Only the workspace/operator may change catalog visibility or installation policy.
			seeds[i].Catalog.Listed = entry.Listed
			seeds[i].Catalog.InstallPolicy = entry.InstallPolicy
			seeds[i].Catalog.Availability = entry.Availability
		}
		service.Repository = repo
		return service.ReconcileSystemReleases(ctx, seeds)
	})
}

func systemReleases(knowledgeURL, canvasURL string) ([]application.AgentPluginReleaseSeed, error) {
	endpoints := map[string]string{"knowledge@platform": knowledgeURL, "canvas@platform": canvasURL}
	var manifests []domain.AgentPluginManifest
	if err := json.Unmarshal(systemPlugins, &manifests); err != nil {
		return nil, err
	}
	seeds := make([]application.AgentPluginReleaseSeed, 0, len(manifests))
	for _, manifest := range manifests {
		base, err := url.Parse(endpoints[manifest.ID])
		if err != nil || base.Host == "" || (base.Scheme != "http" && base.Scheme != "https") || base.User != nil || base.RawQuery != "" || base.Fragment != "" || len(manifest.MCPServers) != 1 {
			return nil, fmt.Errorf("invalid built-in MCP endpoint for %s", manifest.ID)
		}
		manifest.MCPServers[0].URL = base.ResolveReference(&url.URL{Path: "/mcp"}).String()
		release, err := application.SealAgentPluginManifest(manifest)
		if err != nil {
			return nil, err
		}
		seeds = append(seeds, application.AgentPluginReleaseSeed{Manifest: release, Catalog: domain.AgentPluginCatalogEntry{
			ID: release.ID, DisplayName: release.DisplayName, Description: release.Description, Source: release.Source, Trust: release.Trust,
			InstallPolicy: domain.AgentPluginAvailable, Availability: "available", Listed: true,
		}})
	}
	return seeds, nil
}
