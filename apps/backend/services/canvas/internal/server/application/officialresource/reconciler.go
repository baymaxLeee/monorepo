// Package officialresource 按官方清单对账 OFFICIAL Resource 及其唯一 ResourceAsset。
//
// 对账是受信系统行为，不接受任何调用方输入，因此不违反「用户不得篡改官方资源」
// （ADR-002）。它在两处触发：服务启动时对已存在官方记录的各 scope 执行，以及某 scope
// 首次读资源库、该 scope 下尚无官方记录时按清单物化一份。
//
// 之所以需要按 scope 物化：OFFICIAL Resource 与 PROJECT Resource 共用 resources 表和
// 同一套 tenant/workspace 条件，官方记录必须在调用方 scope 下真实存在才可见，而 AgentFrame
// 没有租户枚举来源，无法在启动时预先为所有租户铺好行。
package officialresource

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	applicationasset "github.com/example/monorepo/canvas/internal/server/application/asset"
	applicationofficialasset "github.com/example/monorepo/canvas/internal/server/application/officialasset"
	applicationresource "github.com/example/monorepo/canvas/internal/server/application/resource"
	domainasset "github.com/example/monorepo/canvas/internal/server/domain/asset"
	domainofficialasset "github.com/example/monorepo/canvas/internal/server/domain/officialasset"
	domainresource "github.com/example/monorepo/canvas/internal/server/domain/resource"
)

// OfficialOwnerID 是官方 Resource 在无 scope 派生场景下的保留 owner_id 基准值。
//
// owner_id 列是 UUID 且强校验 UUIDv7 + RFC 4122，因此既不能填 "system" 也不能填全 0
// UUID（全 0 的 version 与 variant 位都不合规）。这里取形似全 0、仅 version 位为 7 与
// variant 位为 8 的保留值，表示「系统持有，不属于任何 Project」。
const OfficialOwnerID = "00000000-0000-7000-8000-000000000000"

// officialCreatedBy 是官方记录的审计创建者。
const officialCreatedBy = "system"

var ErrOfficialPrimaryResourceAssetMismatch = errors.New("official primary resource asset mismatch")

// OfficialOwnerIDFor 按 scope 派生官方 Resource 的 owner_id。
//
// 必须按 scope 派生而不能全租户共用一个哨兵值：resources 的名称唯一索引是
// (owner_type, owner_id, name, deleted_at)，不含 tenant/workspace。若所有 scope 共用
// 同一个 owner_id，第二个租户物化同名官方条目就会撞名称冲突，导致只有第一个租户能拿到
// 官方资源。把 scope 折进 owner_id 后，该索引天然表达「官方名称在每个 scope 内唯一」。
//
// 派生是确定性的：同一 scope 每次得到同一个 ID，因此重跑对账不会产生新的所有权标识。
func OfficialOwnerIDFor(scope domainofficialasset.Scope) string {
	workspace := ""
	if scope.WorkspaceID != nil {
		workspace = *scope.WorkspaceID
	}
	sum := sha256.Sum256([]byte("official-owner\x00" + scope.TenantID + "\x00" + workspace))
	var raw [16]byte
	copy(raw[:], sum[:16])
	raw[6] = (raw[6] & 0x0f) | 0x70 // UUID version 7
	raw[8] = (raw[8] & 0x3f) | 0x80 // RFC 4122 variant
	return uuid.UUID(raw).String()
}

// ManifestEntry 是官方清单中的一条条目，声明一个完整对象：一个官方 Resource + 其唯一
// ResourceAsset + 一份素材内容，三者 1:1。
//
// 条目对素材类型不作假设：音色、形象、场景、道具等各类官方预置都用同一结构表达，差异只在
// Type / MediaType / 文件扩展名 / ContentType 等由素材本身决定的字段。
type ManifestEntry struct {
	// Slug 是对账的匹配键。它与名称、内容都解耦，因此改名与换内容都不会被误判成
	// 「旧条目下线 + 新条目上线」。
	Slug        string
	Type        domainresource.Type
	Name        string
	Description string
	SlotName    string
	// FileName 是素材的原始文件名，决定资产展示名（名称 = 文件名去掉前后缀），也作为发送给
	// 模型的文件名（与用户自上传一致）。
	FileName string
	// FileExt 是素材文件在预置目录中的扩展名（含点，如 ".mp3"、".png"），用于按 slug 定位
	// 文件。与 FileName 分开：FileName 可能含空格/非 ASCII，不适合直接做文件系统键。
	FileExt string
	// ContentType 是素材的 MIME 类型（如 "audio/mpeg"、"image/png"）。由素材本身决定而非
	// 从 MediaType 猜测：同一 MediaType 可能对应多种格式（图片可为 png/jpeg/webp）。
	ContentType string
	MediaType   domainasset.MediaType
}

// valid 校验条目自洽。产物就位的官方预置必须带 FileName / FileExt / ContentType：对账据此
// 从预置目录读文件并注册内部 Asset。
func (e ManifestEntry) valid() bool {
	return e.Slug != "" && e.Type.Valid() && e.Name != "" &&
		e.SlotName != "" && e.MediaType.Valid() &&
		e.FileName != "" && e.FileExt != "" && e.ContentType != ""
}

// ResourceStore 是对账需要的 Resource 侧写入能力，全部只作用于 OFFICIAL 记录。
type ResourceStore interface {
	CreateOfficial(context.Context, domainresource.Resource, domainresource.ResourceAsset) error
	GetOfficial(context.Context, applicationresource.Scope, string) (domainresource.Resource, error)
	UpdateOfficial(context.Context, applicationresource.Scope, domainresource.Resource) error
	GetResourceAsset(context.Context, string, string) (domainresource.ResourceAsset, error)
	UpdateResourceAsset(context.Context, domainresource.ResourceAsset, int64, *string) error
	Delete(context.Context, domainresource.Resource, time.Time) error
}

type IDGenerator interface{ NewID() (string, error) }

type Clock interface{ Now() time.Time }

type TransactionManager interface {
	WithinTransaction(context.Context, func(context.Context) error) error
}

// Manifest 提供当前官方清单。U3「官方预置音色来源文件清单」交付前由代码内常量占位。
type Manifest interface{ Entries() []ManifestEntry }

type Reconciler struct {
	officialAssets applicationofficialasset.Repository
	resources      ResourceStore
	transactions   TransactionManager
	manifest       Manifest
	ids            IDGenerator
	clock          Clock
	// provisioner 把已登记但尚未就绪的条目推进到「已注册内部 Asset」。可为 nil：未接入上传
	// 能力时对账退化为「只登记、跳过挂载」，与产物就位前的行为一致。
	provisioner *Provisioner
	references  interface {
		AcquireAssets(context.Context, applicationasset.AcquireAssetsInput) error
		ReleaseAllAssets(context.Context, applicationasset.ReleaseAllAssetsInput) error
	}
}

func NewReconciler(
	officialAssets applicationofficialasset.Repository,
	resources ResourceStore,
	transactions TransactionManager,
	manifest Manifest,
	ids IDGenerator,
	clock Clock,
) *Reconciler {
	return &Reconciler{
		officialAssets: officialAssets, resources: resources, transactions: transactions,
		manifest: manifest, ids: ids, clock: clock,
	}
}

// WithProvisioner 返回接入了上传注册能力的 Reconciler。分离构造是为了让不依赖上传的测试
// 与场景仍能直接用 NewReconciler，同时让装配处显式表达「这条对账会推进上传」。
func (r *Reconciler) WithProvisioner(provisioner *Provisioner) *Reconciler {
	r.provisioner = provisioner
	return r
}

func (r *Reconciler) WithAssetReferences(references interface {
	AcquireAssets(context.Context, applicationasset.AcquireAssetsInput) error
	ReleaseAllAssets(context.Context, applicationasset.ReleaseAllAssetsInput) error
}) *Reconciler {
	r.references = references
	return r
}

// Result 汇总一次对账的动作数量，供调用方记录与断言。
type Result struct {
	Created  int
	Updated  int
	Revised  int
	Removed  int
	Pending  int
	Skipped  int
	Unchange int
}

// Reconcile 让某个 scope 下的官方记录完整收敛到清单声明的状态，包括在清单为空时下线该
// scope 下全部既有官方记录。启动对账走这个入口。
//
// 幂等：同一清单重复执行不产生额外新增或重复删除。
func (r *Reconciler) Reconcile(
	ctx context.Context, scope domainofficialasset.Scope,
) (Result, error) {
	return r.reconcile(ctx, scope, false)
}

// reconcile 的 skipWhenManifestEmpty 只对读路径物化为 true：物化挂在高频读入口上，清单
// 为空时直接返回可以完全不访问数据库。启动对账必须传 false，否则清空清单永远不会下线既有
// 官方记录。
func (r *Reconciler) reconcile(
	ctx context.Context, scope domainofficialasset.Scope, skipWhenManifestEmpty bool,
) (Result, error) {
	var result Result
	if !scope.Valid() {
		return result, domainofficialasset.ErrInvalidScope
	}
	entries := r.manifest.Entries()
	if len(entries) == 0 && skipWhenManifestEmpty {
		return result, nil
	}
	stored, err := r.officialAssets.ListByScope(ctx, scope)
	if err != nil {
		return result, fmt.Errorf("list official assets: %w", err)
	}
	bySlug := make(map[string]domainofficialasset.OfficialAsset, len(stored))
	for _, item := range stored {
		bySlug[item.Slug] = item
	}

	declared := make(map[string]struct{})
	var provisionFailures []error
	for _, entry := range entries {
		if !entry.valid() {
			return result, fmt.Errorf("%w: manifest entry %q", domainofficialasset.ErrInvalidOfficialAsset, entry.Slug)
		}
		declared[entry.Slug] = struct{}{}
		existing, found := bySlug[entry.Slug]
		if !found {
			// 清单声明了条目，但本 scope 尚无记录：先登记待上传条目，再在同一轮内推进
			// 上传与物化（reconcileEntry 内按需 provision），让产物就位的条目首轮即可上线。
			registered, err := r.register(ctx, scope, entry)
			if err != nil {
				return result, err
			}
			existing = registered
		}
		action, err := r.reconcileEntry(ctx, scope, entry, existing)
		if err != nil {
			// provision 是尽力而为：单条上传/注册失败已在 official_assets 落 FAILED，累积错误
			// 但继续处理其余条目，避免一条素材的问题让整个 scope 停摆。失败条目记为跳过，
			// 下一轮对账据 NeedsReupload 重传。其余错误仍视为致命并中断。
			if action == actionSkipped {
				provisionFailures = append(provisionFailures, err)
				result.Skipped++
				continue
			}
			return result, err
		}
		switch action {
		case actionCreated:
			result.Created++
		case actionUpdated:
			result.Updated++
		case actionRevised:
			result.Revised++
		case actionSkipped:
			result.Skipped++
		case actionPending:
			result.Pending++
		default:
			result.Unchange++
		}
	}

	for _, item := range stored {
		if _, stillDeclared := declared[item.Slug]; stillDeclared {
			continue
		}
		if err := r.remove(ctx, scope, item); err != nil {
			return result, err
		}
		result.Removed++
	}
	return result, errors.Join(provisionFailures...)
}

type action int

const (
	actionUnchanged action = iota
	actionCreated
	actionUpdated
	actionRevised
	actionSkipped
	actionPending
)

// register 登记一条尚未上传的清单条目，不创建 Resource：没有内容的官方条目不该产生空
// 插槽（官方 ResourceAsset 上限为 1，空插槽会占满该上限）。返回登记后的条目供同轮推进。
func (r *Reconciler) register(
	ctx context.Context, scope domainofficialasset.Scope, entry ManifestEntry,
) (domainofficialasset.OfficialAsset, error) {
	item, err := domainofficialasset.New(domainofficialasset.NewInput{
		Slug: entry.Slug, Scope: scope, FileName: entry.FileName,
		MediaType: entry.MediaType, Now: r.clock.Now(),
	})
	if err != nil {
		return domainofficialasset.OfficialAsset{}, err
	}
	err = r.officialAssets.Create(ctx, item)
	// 并发对账的失败方：胜出方已登记同一条目，读回其记录继续推进本轮。
	if errors.Is(err, applicationofficialasset.ErrAlreadyExists) {
		return r.officialAssets.Get(ctx, scope, entry.Slug)
	}
	if err != nil {
		return domainofficialasset.OfficialAsset{}, err
	}
	return item, nil
}

func (r *Reconciler) reconcileEntry(
	ctx context.Context, scope domainofficialasset.Scope,
	entry ManifestEntry, existing domainofficialasset.OfficialAsset,
) (action, error) {
	// 每轮都让 Provisioner 比较源文件摘要：已完成条目也可能在同一 slug 下换内容。
	if r.provisioner != nil {
		provisioned, err := r.provisioner.Provision(ctx, scope, entry, existing)
		if err != nil {
			if errors.Is(err, ErrSharedBlobPending) {
				return actionPending, nil
			}
			// 单条上传失败不中断整个 scope：记为跳过，失败已在 official_assets 落 FAILED，
			// 下一轮对账会重传。错误交由上层合并观测。
			return actionSkipped, err
		}
		existing = provisioned
	}

	assetID, mountable := existing.MountableAssetID()
	if !mountable {
		// 上传尚未完成：跳过物化与换版，等下一轮对账补上。
		return actionPending, nil
	}
	if !existing.Materialized() {
		return actionCreated, r.materialize(ctx, scope, entry, existing, assetID)
	}
	return r.updateMaterialized(ctx, scope, entry, existing, assetID)
}

// materialize 为已完成上传、但本 scope 尚未物化的条目创建 Resource 与其唯一 ResourceAsset。
func (r *Reconciler) materialize(
	ctx context.Context, scope domainofficialasset.Scope,
	entry ManifestEntry, existing domainofficialasset.OfficialAsset, assetID string,
) error {
	now := r.clock.Now()
	resourceID, err := r.ids.NewID()
	if err != nil {
		return err
	}
	slotID, err := r.ids.NewID()
	if err != nil {
		return err
	}
	item, err := domainresource.New(domainresource.NewInput{
		ID: resourceID, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
		OwnerType: domainresource.OwnerOfficial, OwnerID: OfficialOwnerIDFor(scope),
		Type: entry.Type, Name: entry.Name, Description: entry.Description,
		CreatedBy: officialCreatedBy, Now: now,
	})
	if err != nil {
		return err
	}
	slot, err := domainresource.NewResourceAsset(domainresource.NewResourceAssetInput{
		ID: slotID, ResourceID: resourceID, Name: entry.SlotName,
		SequenceNo:     1,
		CurrentAssetID: assetID, MediaType: entry.MediaType, Now: now,
	})
	if err != nil {
		return err
	}
	updated, err := existing.Materialize(resourceID, slotID, now)
	if err != nil {
		return err
	}
	err = r.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		if createErr := r.resources.CreateOfficial(txCtx, item, slot); createErr != nil {
			return createErr
		}
		if r.references != nil {
			if createErr := r.references.AcquireAssets(txCtx, applicationasset.AcquireAssetsInput{
				Scope:    applicationasset.ReferenceScope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID},
				Owner:    applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerResourceAssetRevision, Key: slot.ID},
				AssetIDs: []string{assetID},
			}); createErr != nil {
				return createErr
			}
		}
		return r.officialAssets.Save(txCtx, updated)
	})
	// 并发物化的失败方撞名称唯一索引；其事务不保留局部写入，
	// 胜出方的完整映射会在下一轮被读到。
	if errors.Is(err, applicationresource.ErrNameConflict) {
		return nil
	}
	return err
}

// updateMaterialized 处理已物化条目的两类漂移：内容换了走换版，元信息换了就地更新。
// 两者独立判定，可以在同一轮各自发生。
func (r *Reconciler) updateMaterialized(
	ctx context.Context, scope domainofficialasset.Scope,
	entry ManifestEntry, existing domainofficialasset.OfficialAsset, assetID string,
) (action, error) {
	current, err := r.resources.GetOfficial(ctx, applicationresource.Scope{
		TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
	}, existing.ResourceID)
	if err != nil {
		if errors.Is(err, applicationresource.ErrNotFound) {
			return actionCreated, r.resetAndMaterialize(ctx, scope, entry, existing, assetID)
		}
		return actionUnchanged, err
	}

	slot, err := r.resources.GetResourceAsset(ctx, existing.ResourceID, existing.ResourceAssetID)
	if err != nil {
		if errors.Is(err, applicationresource.ErrResourceAssetNotFound) {
			now := r.clock.Now()
			if err := current.Delete(current.Revision, now); err != nil {
				return actionUnchanged, err
			}
			if err := r.resources.Delete(ctx, current, now); err != nil {
				return actionUnchanged, err
			}
			return actionCreated, r.resetAndMaterialize(ctx, scope, entry, existing, assetID)
		}
		return actionUnchanged, err
	}

	result := actionUnchanged
	if current.PrimaryResourceAssetID == nil || *current.PrimaryResourceAssetID != slot.ID {
		return actionUnchanged, ErrOfficialPrimaryResourceAssetMismatch
	}
	if current.Name != entry.Name || current.Description != entry.Description {
		if err := r.updateMetadata(ctx, scope, current, entry); err != nil {
			return actionUnchanged, err
		}
		result = actionUpdated
	}

	if !existing.NeedsRevision(slot.CurrentAssetID) {
		return result, nil
	}
	if err := r.revise(ctx, scope, slot, entry, assetID); err != nil {
		return actionUnchanged, err
	}
	return actionRevised, nil
}

func (r *Reconciler) resetAndMaterialize(
	ctx context.Context, scope domainofficialasset.Scope,
	entry ManifestEntry, existing domainofficialasset.OfficialAsset, assetID string,
) error {
	reset, err := existing.ResetMaterialization(r.clock.Now())
	if err != nil {
		return err
	}
	if err := r.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		if r.references != nil && existing.ResourceAssetID != "" {
			if releaseErr := r.references.ReleaseAllAssets(txCtx, applicationasset.ReleaseAllAssetsInput{
				Scope: applicationasset.ReferenceScope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID},
				Owner: applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerResourceAssetRevision, Key: existing.ResourceAssetID},
			}); releaseErr != nil {
				return releaseErr
			}
		}
		return r.officialAssets.Save(txCtx, reset)
	}); err != nil {
		return err
	}
	return r.materialize(ctx, scope, entry, reset, assetID)
}

func (r *Reconciler) updateMetadata(
	ctx context.Context, scope domainofficialasset.Scope,
	current domainresource.Resource, entry ManifestEntry,
) error {
	changed, err := current.Update(entry.Name, entry.Description, current.Revision, r.clock.Now())
	if err != nil {
		return err
	}
	if !changed {
		return nil
	}
	return r.resources.UpdateOfficial(ctx, applicationresource.Scope{
		TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
	}, current)
}

// revise 把 ResourceAsset 换版到新的内部 Asset：推进 revision 并追加一条 revision 记录，
// 旧 Asset 与旧 revision 不被改写（ADR-010：内容不可原地改写）。
func (r *Reconciler) revise(
	ctx context.Context, scope domainofficialasset.Scope, slot domainresource.ResourceAsset, entry ManifestEntry, assetID string,
) error {
	expectedRevision := slot.Revision
	changed, err := slot.SelectUploadedAsset(assetID, entry.MediaType, expectedRevision, r.clock.Now())
	if err != nil {
		return err
	}
	if !changed {
		return nil
	}
	return r.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		if err := r.resources.UpdateResourceAsset(txCtx, slot, expectedRevision, &assetID); err != nil {
			return err
		}
		if r.references == nil {
			return nil
		}
		referenceScope := applicationasset.ReferenceScope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID}
		owner := applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerResourceAssetRevision, Key: slot.ID}
		return r.references.AcquireAssets(txCtx, applicationasset.AcquireAssetsInput{
			Scope:    referenceScope,
			Owner:    owner,
			AssetIDs: []string{assetID},
		})
	})
}

// remove 软删除已从清单下线的条目，并在同一事务释放官方上传与 ResourceAsset revision
// 对 Asset 的持有。Asset metadata 仍交给统一 GC 回收。
func (r *Reconciler) remove(
	ctx context.Context, scope domainofficialasset.Scope, item domainofficialasset.OfficialAsset,
) error {
	now := r.clock.Now()
	return r.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		if item.Materialized() {
			current, err := r.resources.GetOfficial(txCtx, applicationresource.Scope{
				TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
			}, item.ResourceID)
			switch {
			case err == nil:
				current.Revision++
				current.UpdatedAt = now.UTC()
				if err = r.resources.Delete(txCtx, current, now); err != nil {
					return err
				}
			case errors.Is(err, applicationresource.ErrNotFound):
			default:
				return err
			}
		}
		err := r.officialAssets.SoftDelete(txCtx, scope, item.Slug, now.UnixMilli())
		if errors.Is(err, applicationofficialasset.ErrNotFound) {
			return nil
		}
		if err != nil || r.references == nil {
			return err
		}
		referenceScope := applicationasset.ReferenceScope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID}
		if item.ResourceAssetID != "" {
			if err = r.references.ReleaseAllAssets(txCtx, applicationasset.ReleaseAllAssetsInput{
				Scope: referenceScope,
				Owner: applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerResourceAssetRevision, Key: item.ResourceAssetID},
			}); err != nil {
				return err
			}
		}
		if item.InternalAssetID != "" {
			return r.references.ReleaseAllAssets(txCtx, applicationasset.ReleaseAllAssetsInput{
				Scope: referenceScope,
				Owner: applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerOfficialAssetUpload, Key: item.InternalAssetID},
			})
		}
		return nil
	})
}

// ReconcileAll 对已有官方记录的全部 scope 执行一次完整对账，供服务启动期调用。
//
// 只作用于已存在官方记录的 scope，而不是枚举租户：AgentFrame 没有租户枚举来源；尚无官方记录
// 的 scope 由首次读物化负责（见设计文档「按 scope 物化」）。
//
// 走 Reconcile 而非读路径入口，因此清单为空时**不**跳过：清空或下架官方条目正是靠这里
// 收敛，读路径的空清单短路只为保护高频读性能。
//
// 单个 scope 失败不中断其余 scope：启动对账是尽力收敛，一个租户的数据问题不应让其他租户
// 的官方资源停在旧状态。全部错误合并返回供调用方观测。
func (r *Reconciler) ReconcileAll(ctx context.Context) (Result, error) {
	scopes, err := r.officialAssets.ListScopes(ctx)
	if err != nil {
		return Result{}, fmt.Errorf("list official asset scopes: %w", err)
	}
	var (
		total  Result
		failed []error
	)
	for _, scope := range scopes {
		result, reconcileErr := r.Reconcile(ctx, scope)
		if reconcileErr != nil {
			failed = append(failed, fmt.Errorf("reconcile scope %q: %w", scope.TenantID, reconcileErr))
			continue
		}
		total.Created += result.Created
		total.Updated += result.Updated
		total.Revised += result.Revised
		total.Removed += result.Removed
		total.Pending += result.Pending
		total.Skipped += result.Skipped
		total.Unchange += result.Unchange
	}
	return total, errors.Join(failed...)
}

func (r *Reconciler) DeleteByTenant(ctx context.Context, tenantID, operatorID string) error {
	if strings.TrimSpace(tenantID) == "" || strings.TrimSpace(operatorID) == "" {
		return domainofficialasset.ErrInvalidScope
	}
	scopes, err := r.officialAssets.ListScopes(ctx)
	if err != nil {
		return fmt.Errorf("list official asset scopes: %w", err)
	}
	for _, scope := range scopes {
		if scope.TenantID != tenantID {
			continue
		}
		if err := r.deleteScope(ctx, scope); err != nil {
			return fmt.Errorf("delete official resource tenant scope: %w", err)
		}
	}
	return nil
}

func (r *Reconciler) DeleteByWorkspace(
	ctx context.Context,
	tenantID string,
	workspaceID string,
	operatorID string,
) error {
	if strings.TrimSpace(tenantID) == "" || strings.TrimSpace(workspaceID) == "" ||
		strings.TrimSpace(operatorID) == "" {
		return domainofficialasset.ErrInvalidScope
	}
	return r.deleteScope(ctx, domainofficialasset.Scope{TenantID: tenantID, WorkspaceID: &workspaceID})
}

func (r *Reconciler) deleteScope(ctx context.Context, scope domainofficialasset.Scope) error {
	items, err := r.officialAssets.ListByScope(ctx, scope)
	if err != nil {
		return err
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Slug < items[j].Slug })
	for _, item := range items {
		if err := r.remove(ctx, scope, item); err != nil {
			return err
		}
	}
	return nil
}
