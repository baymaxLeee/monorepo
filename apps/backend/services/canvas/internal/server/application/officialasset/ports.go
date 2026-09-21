// Package officialasset 声明官方素材清单映射的应用层端口。当前只有受信对账写入本表，
// 面向用户的接口既不创建也不修改它，因此这里只定义 repository 契约与 sentinel error，
// 不提供面向用户的 use case service。
package officialasset

import (
	"context"
	"errors"
	"time"

	domainofficialasset "github.com/example/monorepo/canvas/internal/server/domain/officialasset"
)

var (
	ErrNotFound      = errors.New("official asset not found")
	ErrAlreadyExists = errors.New("official asset already exists")
	// ErrInternalAssetConflict 表示目标内部 Asset 在本 scope 下已被另一条清单条目绑定。
	// 同一 scope 内 slug 与内部 Asset 是 1:1。
	ErrInternalAssetConflict   = errors.New("official asset internal asset already mapped")
	ErrSharedBlobNotFound      = errors.New("official shared blob not found")
	ErrSharedBlobAlreadyExists = errors.New("official shared blob already exists")
	ErrSharedBlobLeaseConflict = errors.New("official shared blob lease conflict")
)

type Repository interface {
	Create(context.Context, domainofficialasset.OfficialAsset) error
	Get(context.Context, domainofficialasset.Scope, string) (domainofficialasset.OfficialAsset, error)
	GetByInternalAssetID(context.Context, domainofficialasset.Scope, string) (domainofficialasset.OfficialAsset, error)
	Save(context.Context, domainofficialasset.OfficialAsset) error
	// ListByScope 返回该 scope 下全部未删除条目，供对账比对清单与库中现状。
	ListByScope(context.Context, domainofficialasset.Scope) ([]domainofficialasset.OfficialAsset, error)
	// ListScopes 枚举已有官方记录的全部 scope，供启动对账逐个收敛。
	//
	// 启动对账只作用于已存在官方记录的 scope，而不是枚举租户：AgentFrame 没有租户枚举来源，
	// 尚无官方记录的 scope 由首次读物化负责。
	ListScopes(context.Context) ([]domainofficialasset.Scope, error)
	// ListByLongLiveStatus 供运维任务按注册状态挑选待上传、待注册或需重传的条目。
	ListByLongLiveStatus(context.Context, domainofficialasset.Scope, domainofficialasset.LongLiveStatus, int32) ([]domainofficialasset.OfficialAsset, error)
	// SoftDelete 移除已从官方清单下线的条目。Asset 内容与注册记录本身保留，因此同一
	// slug 重新上架时可复用既有内容。
	SoftDelete(context.Context, domainofficialasset.Scope, string, int64) error
}

type SharedBlobRepository interface {
	GetSharedBlob(context.Context, string, string) (domainofficialasset.SharedBlob, error)
	CreateSharedBlob(context.Context, domainofficialasset.SharedBlob) error
	ClaimSharedBlob(context.Context, string, string, string, time.Time, time.Time) (bool, error)
	CompleteSharedBlob(context.Context, string, string, string, string, int64, time.Time) error
	FailSharedBlob(context.Context, string, string, string, time.Time) error
	InvalidateSharedBlob(context.Context, string, string, string, time.Time) (bool, error)
}
