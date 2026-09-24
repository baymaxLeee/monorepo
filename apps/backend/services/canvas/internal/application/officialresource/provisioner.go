package officialresource

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"

	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	applicationofficialasset "github.com/example/monorepo/canvas/internal/application/officialasset"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domainofficialasset "github.com/example/monorepo/canvas/internal/domain/officialasset"
)

type AssetBytesSource interface {
	AssetBytes(slug, ext string) ([]byte, error)
}

// PlatformAssetUploader streams official content into the platform Asset
// control plane. Physical dedupe and upload leases belong to that service.
type PlatformAssetUploader interface {
	UploadPlatformRevision(context.Context, string, *string, string, string, string, string, io.Reader) (applicationasset.ResolvedRevision, error)
}

type AssetStore interface {
	Create(context.Context, domainasset.Asset) error
}

type Provisioner struct {
	officialAssets applicationofficialasset.Repository
	assets         AssetStore
	uploader       PlatformAssetUploader
	source         AssetBytesSource
	ids            IDGenerator
	clock          Clock
	transactions   TransactionManager
	references     interface {
		AcquireAssets(context.Context, applicationasset.AcquireAssetsInput) error
		ReleaseAllAssets(context.Context, applicationasset.ReleaseAllAssetsInput) error
	}
}

func (p *Provisioner) WithTransactions(transactions TransactionManager) *Provisioner {
	p.transactions = transactions
	return p
}

func (p *Provisioner) WithAssetReferences(references interface {
	AcquireAssets(context.Context, applicationasset.AcquireAssetsInput) error
	ReleaseAllAssets(context.Context, applicationasset.ReleaseAllAssetsInput) error
}) *Provisioner {
	p.references = references
	return p
}

func NewProvisioner(
	officialAssets applicationofficialasset.Repository, assets AssetStore, uploader PlatformAssetUploader,
	source AssetBytesSource, ids IDGenerator, clock Clock,
) *Provisioner {
	return &Provisioner{officialAssets: officialAssets, assets: assets, uploader: uploader, source: source, ids: ids, clock: clock}
}

func (p *Provisioner) Provision(
	ctx context.Context, scope domainofficialasset.Scope, entry ManifestEntry, item domainofficialasset.OfficialAsset,
) (domainofficialasset.OfficialAsset, error) {
	data, err := p.source.AssetBytes(entry.Slug, entry.FileExt)
	if err != nil {
		return item, fmt.Errorf("load preset asset %q: %w", entry.Slug, err)
	}
	fileSHA256 := sha256Hex(data)
	if !item.NeedsRegistration(fileSHA256) {
		return item, nil
	}
	previousAssetID := item.InternalAssetID
	registering, err := item.BeginRegistration(p.clock.Now())
	if err != nil {
		return item, err
	}
	if err = p.officialAssets.Save(ctx, registering); err != nil {
		return item, fmt.Errorf("save registering scope for %q: %w", entry.Slug, err)
	}
	revision, err := p.uploader.UploadPlatformRevision(
		ctx, scope.TenantID, scope.WorkspaceID, officialCreatedBy, entry.FileName, entry.ContentType,
		"official-resource:"+entry.Slug+":"+fileSHA256, bytes.NewReader(data),
	)
	if err != nil {
		return p.markFailed(ctx, registering, fmt.Errorf("upload preset asset %q: %w", entry.Slug, err))
	}
	assetID, err := p.ids.NewID()
	if err != nil {
		return p.markFailed(ctx, registering, fmt.Errorf("generate asset id for %q: %w", entry.Slug, err))
	}
	asset, err := domainasset.New(domainasset.NewInput{
		ID: assetID, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
		OwnerType: domainasset.OwnerOfficial, OwnerID: OfficialOwnerIDFor(scope),
		SourceAssetID: revision.SourceAssetID, SourceRevisionID: revision.SourceRevisionID, FileName: entry.FileName,
		MediaType: entry.MediaType, ContentType: entry.ContentType, SizeBytes: revision.SizeBytes,
		CreatedBy: officialCreatedBy, Now: p.clock.Now(),
	})
	if err != nil {
		return p.markFailed(ctx, registering, fmt.Errorf("build official asset for %q: %w", entry.Slug, err))
	}
	registered, err := registering.MarkRegistered(domainofficialasset.RegistrationResult{
		SourceAssetID: revision.SourceAssetID, SourceRevisionID: revision.SourceRevisionID, InternalAssetID: assetID,
		FileSHA256: fileSHA256, SizeBytes: revision.SizeBytes, Now: p.clock.Now(),
	})
	if err != nil {
		return registering, err
	}
	persist := func(txCtx context.Context) error {
		if persistErr := p.assets.Create(txCtx, asset); persistErr != nil {
			return fmt.Errorf("persist official asset for %q: %w", entry.Slug, persistErr)
		}
		if p.references != nil {
			if persistErr := p.references.AcquireAssets(txCtx, applicationasset.AcquireAssetsInput{
				Scope:    applicationasset.ReferenceScope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID},
				Owner:    applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerOfficialAssetUpload, Key: assetID},
				AssetIDs: []string{assetID},
			}); persistErr != nil {
				return fmt.Errorf("acquire official asset reference for %q: %w", entry.Slug, persistErr)
			}
		}
		if persistErr := p.officialAssets.Save(txCtx, registered); persistErr != nil {
			return fmt.Errorf("save registered preset %q: %w", entry.Slug, persistErr)
		}
		if p.references != nil && previousAssetID != "" && previousAssetID != assetID {
			return p.references.ReleaseAllAssets(txCtx, applicationasset.ReleaseAllAssetsInput{
				Scope: applicationasset.ReferenceScope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID},
				Owner: applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerOfficialAssetUpload, Key: previousAssetID},
			})
		}
		return nil
	}
	if p.transactions != nil {
		err = p.transactions.WithinTransaction(ctx, persist)
	} else {
		err = persist(ctx)
	}
	if err != nil {
		return p.markFailed(ctx, registering, err)
	}
	return registered, nil
}

func (p *Provisioner) markFailed(ctx context.Context, item domainofficialasset.OfficialAsset, cause error) (domainofficialasset.OfficialAsset, error) {
	failed, err := item.MarkLongLiveFailed(p.clock.Now())
	if err != nil {
		return item, cause
	}
	if saveErr := p.officialAssets.Save(ctx, failed); saveErr != nil {
		return failed, fmt.Errorf("%w; mark failed: %v", cause, saveErr)
	}
	return failed, cause
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
