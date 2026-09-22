package project

import (
	"context"
	"errors"
	"time"

	applicationquota "github.com/example/monorepo/canvas/internal/application/quota"
	domainproject "github.com/example/monorepo/canvas/internal/domain/project"
)

var (
	ErrNotFound     = errors.New("project not found")
	ErrNameConflict = errors.New("project name conflict")
)

type Scope struct {
	TenantID    string
	WorkspaceID *string
	CallerID    string
	Access      Access
}

type Access uint8

const (
	AccessAdmin Access = iota
	AccessMember
)

// OfficialMaterializer 在某个 scope 首次读项目列表时按官方清单幂等补齐官方记录。
//
// 项目列表是进入工作台的必经入口，因此在此处补齐可以让新租户无需等待重启即可看到官方
// 预置。实现必须自行短路，使稳定态不产生额外查询——它挂在高频读路径上。
//
// 物化是 best-effort：失败不应让项目列表读取失败。
type OfficialMaterializer interface {
	MaterializeForScope(context.Context, Scope)
}

type SortDirection int

const (
	SortUnspecified SortDirection = iota
	SortAscending
	SortDescending
)

type Page struct {
	PageSize int
	PageNum  int
}

type ListQuery struct {
	TenantID      string
	WorkspaceID   *string
	CallerID      string
	Access        Access
	Keyword       string
	SortDirection SortDirection
	PageSize      int
	PageNum       int
}

type Repository interface {
	Create(context.Context, domainproject.Project) error
	Update(context.Context, domainproject.Project) error
	UpdateByMember(context.Context, domainproject.Project) error
	Delete(context.Context, domainproject.Project) error
	Get(context.Context, Scope, string) (domainproject.Project, error)
	GetByTenant(context.Context, string, string) (domainproject.Project, error)
	BatchGet(context.Context, Scope, []string) ([]domainproject.Project, error)
	List(context.Context, ListQuery) ([]domainproject.Project, int64, error)
	ListByTenant(context.Context, string) ([]domainproject.Project, error)
	ListByWorkspace(context.Context, string, string) ([]domainproject.Project, error)
}

type ModelPermissionGateway interface {
	Grant(context.Context, Scope, string, []string) error
	List(context.Context, Scope, ListModelsInput) (ProjectModelList, error)
}

type ProjectUsagePolicy struct {
	ID         string
	ProjectID  string
	Limit      *int64
	UsedAmount float64
}

type ProjectUsagePolicyGateway interface {
	Create(context.Context, Scope, string, *int64) (ProjectUsagePolicy, error)
	Find(context.Context, Scope, string) (*ProjectUsagePolicy, error)
	Update(context.Context, Scope, ProjectUsagePolicy, *int64) (ProjectUsagePolicy, error)
	Delete(context.Context, Scope, string) error
}

type IDGenerator interface {
	NewID() (string, error)
}

type Clock interface {
	Now() time.Time
}

type TransactionManager interface {
	WithinTransaction(context.Context, func(context.Context) error) error
}

type ProjectQuota interface {
	ReserveProject(context.Context, string, string) (applicationquota.Reservation, error)
	CommitProject(context.Context, applicationquota.Reservation) error
	ReleaseProject(context.Context, applicationquota.Reservation) error
	DeleteProject(context.Context, string) error
}

type StorageQuota interface {
	ReserveStorage(context.Context, string, string, string, string, string, int64) (applicationquota.Reservation, error)
	CommitStorage(context.Context, applicationquota.Reservation, applicationquota.StorageObject) error
	MarkStorageReleasing(context.Context, string, string) (bool, error)
	ReleaseStorage(context.Context, string, string) (bool, error)
	ReleaseReservation(context.Context, applicationquota.Reservation) error
}

// ProjectChildCleaner performs best-effort cleanup of resources owned by a project.
// The Project deletion itself must remain successful when this cleanup fails.
type ProjectChildCleaner interface {
	Cleanup(context.Context, Scope, string) error
}

// CleanupFailureReporter makes best-effort cleanup failures observable without
// changing the successful result of the Project deletion use case.
type CleanupFailureReporter interface {
	Report(context.Context, error)
}
