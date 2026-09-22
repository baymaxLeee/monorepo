package officialresource

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"time"

	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	applicationofficialasset "github.com/example/monorepo/canvas/internal/application/officialasset"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domainofficialasset "github.com/example/monorepo/canvas/internal/domain/officialasset"
	"github.com/example/monorepo/canvas/internal/infrastructure/storage/namespace"
)

// AssetBytesSource 按 slug + 扩展名返回官方预置素材的字节。默认实现从预置目录读文件。
// 素材类型无关：音色、形象、场景、道具等都走同一接口。
type AssetBytesSource interface {
	AssetBytes(slug, ext string) ([]byte, error)
}

// BlobUploader 把字节流上传为共享 Blob。对应 up.Store.UploadBlob。
type BlobUploader interface {
	UploadBlob(ctx context.Context, fileName, contentType string, reader io.Reader) (string, int64, error)
}

// ArtifactRegistrar 对已上传的 Blob 调 LongLiveArtifact 建立长期 Artifact。
type ArtifactRegistrar interface {
	Register(ctx context.Context, tenantID, callerID, blobID, fileName, namespace string) (applicationasset.RegisteredArtifact, error)
}

// AssetStore 落一条内部 Asset 记录，供官方 ResourceAsset 挂载。
type AssetStore interface {
	Create(ctx context.Context, item domainasset.Asset) error
}

// Provisioner 把一条已登记但尚未就绪的官方条目推进到「已注册内部 Asset」。
//
// 素材类型无关：音色、形象、场景、道具等各类官方预置都是单素材（一条目 = 一 Resource + 一
// 插槽 + 一份内容），走同一条链路，差异只在清单条目声明的 MediaType / 扩展名 / ContentType。
//
// 完整链路：读素材字节并按摘要获取全局共享 Blob → LongLiveArtifact 取 ArtifactID+Size →
// 建 OwnerOfficial 内部 Asset → MarkRegistered 落库。Blob 上传由独立全局记录及租约协调，
// scope 记录只保存 LongLive 和物化结果。
type Provisioner struct {
	officialAssets applicationofficialasset.Repository
	sharedBlobs    applicationofficialasset.SharedBlobRepository
	assets         AssetStore
	uploader       BlobUploader
	registrar      ArtifactRegistrar
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
	officialAssets applicationofficialasset.Repository,
	sharedBlobs applicationofficialasset.SharedBlobRepository,
	assets AssetStore,
	uploader BlobUploader,
	registrar ArtifactRegistrar,
	source AssetBytesSource,
	ids IDGenerator,
	clock Clock,
) *Provisioner {
	return &Provisioner{
		officialAssets: officialAssets, sharedBlobs: sharedBlobs, assets: assets,
		uploader: uploader, registrar: registrar, source: source,
		ids: ids, clock: clock,
	}
}

var ErrSharedBlobPending = errors.New("official shared blob upload is pending")

const sharedBlobUploadLease = 2 * time.Minute

// Provision 推进一条条目的上传注册，返回推进后的条目。
//
// 幂等：内容摘要未变化且已完成时直接返回。失败时返回标记为 Failed 的条目与错误，让
// 对账把失败计入而非中断整个 scope。
func (p *Provisioner) Provision(
	ctx context.Context, scope domainofficialasset.Scope, entry ManifestEntry,
	item domainofficialasset.OfficialAsset,
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

	now := p.clock.Now()
	registering, err := item.BeginRegistration(now)
	if err != nil {
		return item, err
	}
	if err := p.officialAssets.Save(ctx, registering); err != nil {
		return item, fmt.Errorf("save registering scope for %q: %w", entry.Slug, err)
	}

	shared, err := p.acquireSharedBlob(ctx, entry, data, fileSHA256)
	if err != nil {
		if errors.Is(err, ErrSharedBlobPending) {
			return registering, err
		}
		return p.markFailed(ctx, registering, err)
	}

	namespace, err := (artifactnamespace.Scope{
		TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
	}).Namespace()
	if err != nil {
		return p.markFailed(ctx, registering, fmt.Errorf("derive preset artifact namespace: %w", err))
	}
	registered, err := p.registrar.Register(ctx, scope.TenantID, officialCreatedBy, shared.BlobID, entry.FileName, namespace)
	if err != nil {
		_, invalidateErr := p.sharedBlobs.InvalidateSharedBlob(
			ctx, entry.Slug, fileSHA256, shared.BlobID, p.clock.Now(),
		)
		return p.markFailed(ctx, registering, errors.Join(
			fmt.Errorf("long-live preset asset %q: %w", entry.Slug, err), invalidateErr,
		))
	}

	assetID, err := p.ids.NewID()
	if err != nil {
		return p.markFailed(ctx, registering, fmt.Errorf("generate asset id for %q: %w", entry.Slug, err))
	}
	asset, err := domainasset.New(domainasset.NewInput{
		ID: assetID, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
		OwnerType: domainasset.OwnerOfficial, OwnerID: OfficialOwnerIDFor(scope),
		ArtifactID: registered.ArtifactID, ArtifactNamespace: registered.ArtifactNamespace, FileName: entry.FileName,
		MediaType: entry.MediaType, ContentType: entry.ContentType,
		SizeBytes: registered.SizeBytes, CreatedBy: officialCreatedBy, Now: now,
	})
	if err != nil {
		return p.markFailed(ctx, registering, fmt.Errorf("build official asset for %q: %w", entry.Slug, err))
	}
	registeredItem, err := registering.MarkRegistered(domainofficialasset.RegistrationResult{
		ArtifactID: registered.ArtifactID, InternalAssetID: assetID,
		FileSHA256: fileSHA256, SizeBytes: registered.SizeBytes, Now: p.clock.Now(),
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
		if persistErr := p.officialAssets.Save(txCtx, registeredItem); persistErr != nil {
			return fmt.Errorf("save registered preset %q: %w", entry.Slug, persistErr)
		}
		if p.references != nil && previousAssetID != "" && previousAssetID != assetID {
			if persistErr := p.references.ReleaseAllAssets(txCtx, applicationasset.ReleaseAllAssetsInput{
				Scope: applicationasset.ReferenceScope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID},
				Owner: applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerOfficialAssetUpload, Key: previousAssetID},
			}); persistErr != nil {
				return fmt.Errorf("release replaced official asset reference for %q: %w", entry.Slug, persistErr)
			}
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
	return registeredItem, nil
}

func (p *Provisioner) acquireSharedBlob(
	ctx context.Context, entry ManifestEntry, data []byte, fileSHA256 string,
) (domainofficialasset.SharedBlob, error) {
	shared, err := p.sharedBlobs.GetSharedBlob(ctx, entry.Slug, fileSHA256)
	if errors.Is(err, applicationofficialasset.ErrSharedBlobNotFound) {
		shared, err = domainofficialasset.NewSharedBlob(
			entry.Slug, fileSHA256, entry.FileName, entry.ContentType, p.clock.Now(),
		)
		if err != nil {
			return domainofficialasset.SharedBlob{}, err
		}
		if createErr := p.sharedBlobs.CreateSharedBlob(ctx, shared); createErr != nil &&
			!errors.Is(createErr, applicationofficialasset.ErrSharedBlobAlreadyExists) {
			return domainofficialasset.SharedBlob{}, fmt.Errorf("create shared blob %q: %w", entry.Slug, createErr)
		}
		shared, err = p.sharedBlobs.GetSharedBlob(ctx, entry.Slug, fileSHA256)
	}
	if err != nil {
		return domainofficialasset.SharedBlob{}, fmt.Errorf("get shared blob %q: %w", entry.Slug, err)
	}
	if shared.Available() {
		return shared, nil
	}

	owner, err := p.ids.NewID()
	if err != nil {
		return domainofficialasset.SharedBlob{}, fmt.Errorf("generate shared blob lease owner: %w", err)
	}
	now := p.clock.Now()
	claimed, err := p.sharedBlobs.ClaimSharedBlob(
		ctx, entry.Slug, fileSHA256, owner, now, now.Add(sharedBlobUploadLease),
	)
	if err != nil {
		return domainofficialasset.SharedBlob{}, fmt.Errorf("claim shared blob %q: %w", entry.Slug, err)
	}
	if !claimed {
		shared, getErr := p.sharedBlobs.GetSharedBlob(ctx, entry.Slug, fileSHA256)
		if getErr == nil && shared.Available() {
			return shared, nil
		}
		return domainofficialasset.SharedBlob{}, ErrSharedBlobPending
	}

	blobID, sizeBytes, err := p.uploader.UploadBlob(
		ctx, entry.FileName, entry.ContentType, bytes.NewReader(data),
	)
	if err != nil {
		failErr := p.sharedBlobs.FailSharedBlob(ctx, entry.Slug, fileSHA256, owner, p.clock.Now())
		uploadErr := fmt.Errorf("upload preset asset %q: %w", entry.Slug, err)
		if failErr == nil {
			return domainofficialasset.SharedBlob{}, uploadErr
		}
		return p.resolveSharedBlobMutation(
			ctx, entry.Slug, fileSHA256,
			errors.Join(uploadErr, fmt.Errorf("fail shared blob: %w", failErr)),
		)
	}
	if err := p.sharedBlobs.CompleteSharedBlob(
		ctx, entry.Slug, fileSHA256, owner, blobID, sizeBytes, p.clock.Now(),
	); err != nil {
		return p.resolveSharedBlobMutation(
			ctx, entry.Slug, fileSHA256,
			fmt.Errorf("complete shared blob %q: %w", entry.Slug, err),
		)
	}
	return p.sharedBlobs.GetSharedBlob(ctx, entry.Slug, fileSHA256)
}

// resolveSharedBlobMutation re-reads shared state after a CAS write fails. The lease may
// have moved while UploadBlob was in flight, so the write error alone cannot distinguish
// a completed competing upload from work that is still owned by another process.
func (p *Provisioner) resolveSharedBlobMutation(
	ctx context.Context, slug, fileSHA256 string, mutationErr error,
) (domainofficialasset.SharedBlob, error) {
	shared, err := p.sharedBlobs.GetSharedBlob(ctx, slug, fileSHA256)
	if err != nil {
		return domainofficialasset.SharedBlob{}, errors.Join(
			mutationErr, fmt.Errorf("reload shared blob %q after mutation failure: %w", slug, err),
		)
	}
	if shared.Available() {
		return shared, nil
	}
	if shared.Status == domainofficialasset.SharedBlobUploading {
		return domainofficialasset.SharedBlob{}, ErrSharedBlobPending
	}
	return domainofficialasset.SharedBlob{}, mutationErr
}

// markFailed 把条目标记为 LongLiveFailed 并落库，返回原始失败错误。
//
// 落库失败时把它并入返回错误，但仍以原始失败为主因。
func (p *Provisioner) markFailed(
	ctx context.Context, item domainofficialasset.OfficialAsset, cause error,
) (domainofficialasset.OfficialAsset, error) {
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
