package officialresource

import (
	"context"
	"sync"

	applicationcanvas "github.com/example/monorepo/canvas/internal/application/canvas"
	applicationproject "github.com/example/monorepo/canvas/internal/application/project"
	applicationresource "github.com/example/monorepo/canvas/internal/application/resource"
	domainofficialasset "github.com/example/monorepo/canvas/internal/domain/officialasset"
)

// Materializer 在高频读入口上按官方清单补齐本 scope 的官方记录。
//
// 物化挂在项目列表、资源库列表与分镜素材消费入口上，因此稳定态不能付出对账代价：一次完整对账是
// 1 次 official_assets 扫描加每条已物化条目 2 次读，若每次列表都执行，这个开销会落在
// 几乎所有读请求上。Materializer 用三层短路把稳定态压到零查询：
//
//  1. 清单为空时直接返回，完全不访问数据库（U3 交付前即此状态）；
//  2. 进程内缓存已收敛的 scope，命中即返回；
//  3. 未命中时在后台对账，不阻塞本次读取。
//
// 代价是某 scope 首次请求可能看不到官方预置，下一次刷新才出现。官方预置不是该次读取的
// 正确性前提，用这个延迟换读路径不被拖慢是合适的取舍。
type Materializer struct {
	reconciler *Reconciler
	failures   applicationresource.OfficialMaterializationFailureReporter
	stop       chan struct{}
	stopOnce   sync.Once

	// mu 同时保护 done 与 inflight。
	mu sync.Mutex
	// done 记录已按当前清单收敛的 scope。进程内状态，因此多实例各自物化同一 scope 是
	// 可能的；并发安全由 resources 的名称唯一索引兜底。
	done map[string]struct{}
	// inflight 抑制同一 scope 的并发重复对账：高频读入口下同一 scope 会被密集命中，
	// 没有它会为同一 scope 同时拉起多个后台对账。
	inflight map[string]struct{}

	// wg 只用于测试等待后台对账完成，生产路径不等待。
	wg sync.WaitGroup
}

func NewMaterializer(
	reconciler *Reconciler,
	failures applicationresource.OfficialMaterializationFailureReporter,
) *Materializer {
	return &Materializer{
		reconciler: reconciler, failures: failures,
		stop: make(chan struct{}),
		done: map[string]struct{}{}, inflight: map[string]struct{}{},
	}
}

// MaterializeForScope 在需要时触发后台对账，并立即返回。满足资源库读路径的物化端口。
//
// 返回 nil 不代表官方记录已就位，只代表本次读取无需等待。真实失败通过 reporter 可观测。
func (m *Materializer) MaterializeForScope(ctx context.Context, scope applicationresource.Scope) {
	m.materialize(ctx, domainofficialasset.Scope{
		TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
	})
}

// MaterializeForProjectScope 满足项目列表的物化端口。
//
// project、resource 与 canvas application 包各自持有自己的 Scope 类型，彼此不相互依赖，
// 因此这里按消费入口提供对应方法，而不是让这些 application 包互相引用。
func (m *Materializer) MaterializeForProjectScope(ctx context.Context, scope applicationproject.Scope) {
	m.materialize(ctx, domainofficialasset.Scope{
		TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
	})
}

// MaterializeForCanvasScope 满足分镜素材消费入口的物化端口。
func (m *Materializer) MaterializeForCanvasScope(ctx context.Context, scope applicationcanvas.Scope) {
	m.materialize(ctx, domainofficialasset.Scope{
		TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
	})
}

func (m *Materializer) materialize(ctx context.Context, target domainofficialasset.Scope) {
	if !target.Valid() {
		return
	}
	// 清单为空时不需要任何状态，也不需要落缓存：这一分支本身已是零开销。
	if len(m.reconciler.manifest.Entries()) == 0 {
		return
	}
	key := scopeCacheKey(target)
	if !m.claim(key) {
		return
	}
	go m.run(context.WithoutCancel(ctx), key, target)
}

// claim 判断是否应由本次调用拉起对账：已收敛或已有在途对账时返回 false。
func (m *Materializer) claim(key string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	select {
	case <-m.stop:
		return false
	default:
	}
	if _, converged := m.done[key]; converged {
		return false
	}
	if _, running := m.inflight[key]; running {
		return false
	}
	m.inflight[key] = struct{}{}
	m.wg.Add(1)
	return true
}

// run 在后台对账。
func (m *Materializer) run(requestValues context.Context, key string, scope domainofficialasset.Scope) {
	defer m.wg.Done()
	ctx, cancel := context.WithCancel(requestValues)
	defer cancel()
	go func() {
		select {
		case <-m.stop:
			cancel()
		case <-ctx.Done():
		}
	}()
	result, err := m.reconciler.reconcile(ctx, scope, true)

	m.mu.Lock()
	delete(m.inflight, key)
	if err == nil && result.Pending == 0 {
		// 只有成功才标记收敛，失败时下次读取会自然重试。
		m.done[key] = struct{}{}
	}
	m.mu.Unlock()

	if err != nil && m.failures != nil {
		m.failures.Report(ctx, err)
	}
}

// Stop cancels in-flight background reconciliation and waits for goroutines to exit.
func (m *Materializer) Stop() {
	m.mu.Lock()
	m.stopOnce.Do(func() { close(m.stop) })
	m.mu.Unlock()
	m.wg.Wait()
}

// Invalidate 清空收敛缓存，供清单重新加载后强制下一轮读取重新对账。
func (m *Materializer) Invalidate() {
	m.mu.Lock()
	m.done = map[string]struct{}{}
	m.mu.Unlock()
}

// scopeCacheKey 用 NUL 分隔，避免 tenant 与 workspace 之间产生歧义拼接。
func scopeCacheKey(scope domainofficialasset.Scope) string {
	workspace := ""
	if scope.WorkspaceID != nil {
		workspace = *scope.WorkspaceID
	}
	return scope.TenantID + "\x00" + workspace
}

// ProjectMaterializer 把 Materializer 适配到项目列表的物化端口。
//
// 两个端口的方法名相同但 Scope 类型不同，Go 无法让同一个方法同时满足二者，因此用一层
// 薄封装转发，而不是让 project 与 resource 两个 application 包互相依赖。
type ProjectMaterializer struct{ materializer *Materializer }

func NewProjectMaterializer(materializer *Materializer) *ProjectMaterializer {
	return &ProjectMaterializer{materializer: materializer}
}

func (p *ProjectMaterializer) MaterializeForScope(
	ctx context.Context, scope applicationproject.Scope,
) {
	if p.materializer == nil {
		return
	}
	p.materializer.MaterializeForProjectScope(ctx, scope)
}
