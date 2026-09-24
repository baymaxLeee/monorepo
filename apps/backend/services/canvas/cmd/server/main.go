package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	maturehttp "github.com/example/monorepo/canvas/internal/api/handler"
	"github.com/example/monorepo/canvas/internal/api/openapi"
	"github.com/example/monorepo/canvas/internal/api/requestcontext"
	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	applicationpackage "github.com/example/monorepo/canvas/internal/application/benefitpackage"
	applicationcanvas "github.com/example/monorepo/canvas/internal/application/canvas"
	applicationcanvasarchive "github.com/example/monorepo/canvas/internal/application/canvasarchive"
	applicationcanvasgeneration "github.com/example/monorepo/canvas/internal/application/canvasgeneration"
	applicationcanvasimagegeneration "github.com/example/monorepo/canvas/internal/application/canvasimagegeneration"
	applicationcanvastextgeneration "github.com/example/monorepo/canvas/internal/application/canvastextgeneration"
	applicationcoverimage "github.com/example/monorepo/canvas/internal/application/coverimage"
	applicationdeletion "github.com/example/monorepo/canvas/internal/application/deletion"
	applicationfirstlastframe "github.com/example/monorepo/canvas/internal/application/firstlastframe"
	applicationimagegeneration "github.com/example/monorepo/canvas/internal/application/imagegeneration"
	applicationproject "github.com/example/monorepo/canvas/internal/application/project"
	applicationprojectaccess "github.com/example/monorepo/canvas/internal/application/projectaccess"
	applicationprojectcleanup "github.com/example/monorepo/canvas/internal/application/projectcleanup"
	applicationprojectstatistics "github.com/example/monorepo/canvas/internal/application/projectstatistics"
	applicationprojectusage "github.com/example/monorepo/canvas/internal/application/projectusage"
	applicationquota "github.com/example/monorepo/canvas/internal/application/quota"
	applicationresource "github.com/example/monorepo/canvas/internal/application/resource"
	applicationresourceassetgeneration "github.com/example/monorepo/canvas/internal/application/resourceassetgeneration"
	applicationtask "github.com/example/monorepo/canvas/internal/application/task"
	applicationvideogeneration "github.com/example/monorepo/canvas/internal/application/videogeneration"
	"github.com/example/monorepo/canvas/internal/bootstrap"
	domainimagegeneration "github.com/example/monorepo/canvas/internal/domain/imagegeneration"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	"github.com/example/monorepo/canvas/internal/infrastructure/admin"
	"github.com/example/monorepo/canvas/internal/infrastructure/artifact"
	"github.com/example/monorepo/canvas/internal/infrastructure/canvasstoryboardredis"
	"github.com/example/monorepo/canvas/internal/infrastructure/canvastextgenerationredis"
	coverimagestore "github.com/example/monorepo/canvas/internal/infrastructure/coverimage"
	executorclient "github.com/example/monorepo/canvas/internal/infrastructure/executor"
	canvasarchivemedia "github.com/example/monorepo/canvas/internal/infrastructure/media/canvasarchive"
	firstlastframemedia "github.com/example/monorepo/canvas/internal/infrastructure/media/firstlastframe"
	"github.com/example/monorepo/canvas/internal/infrastructure/observability"
	assetpersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/asset"
	benefitpackagepersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/benefitpackage"
	canvaspersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/canvas"
	canvasarchivepersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/canvasarchive"
	canvasnodepersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/canvasnode"
	canvasstatisticspersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/canvasstatistics"
	canvasstoryboardpersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/canvasstoryboard"
	canvastextgenerationpersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/canvastextgeneration"
	deletionpersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/deletion"
	imagegenerationpersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/imagegeneration"
	projectpersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/project"
	projectaccesspersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/projectaccess"
	projectstatisticspersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/projectstatistics"
	projectusagepersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/projectusage"
	projectusagepolicypersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/projectusagepolicy"
	quotapersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/quota"
	resourcepersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/resource"
	resourceassetgenerationpersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/resourceassetgeneration"
	taskpersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/task"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
	videogenerationpersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/videogeneration"
	"github.com/example/monorepo/canvas/internal/infrastructure/provider"
	providerclient "github.com/example/monorepo/canvas/internal/infrastructure/provider/client"
	modelcatalog "github.com/example/monorepo/canvas/internal/infrastructure/providercatalog"
	"github.com/example/monorepo/canvas/internal/infrastructure/storage"
	"github.com/example/monorepo/canvas/internal/infrastructure/usageobserver"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.uber.org/zap"
)

type uuidGenerator struct{}

func (uuidGenerator) NewID() (string, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return "", err
	}
	return id.String(), nil
}

type utcClock struct{}

func (utcClock) Now() time.Time { return time.Now().UTC() }

type unavailableQuotaLimits struct{}

func (unavailableQuotaLimits) Limit(context.Context, string, applicationquota.ResourceType) (applicationquota.Limit, error) {
	return applicationquota.Limit{}, applicationquota.ErrUnavailable
}

type gatewayProjectPermissions struct{}

func (gatewayProjectPermissions) Permissions(
	ctx context.Context, tenantID string, workspaceID *string, userID string,
) (applicationprojectaccess.Permissions, error) {
	metadata, ok := requestcontext.MetadataFromContext(ctx)
	if !ok || metadata.TenantID != tenantID || metadata.UserID != userID || workspaceID == nil || metadata.WorkspaceID != *workspaceID {
		return applicationprojectaccess.Permissions{}, errors.New("trusted request identity does not match project scope")
	}
	if metadata.WorkspaceRole == "workspace_admin" {
		return applicationprojectaccess.Permissions{Read: true, Update: true}, nil
	}
	return applicationprojectaccess.Permissions{}, nil
}

type archiveCanvasAccess struct {
	canvases interface {
		Validate(context.Context, applicationcanvas.Scope, string, string) error
	}
}

func (access archiveCanvasAccess) Validate(
	ctx context.Context,
	scope applicationcanvasarchive.Scope,
	projectID string,
	canvasID string,
) error {
	return access.canvases.Validate(ctx, applicationcanvas.Scope{
		TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CallerID: scope.CallerID,
	}, projectID, canvasID)
}

const imageTaskCleanupJobKind = "image.task.cleanup.v1"

type resourceGenerationDeletion struct {
	engine interface {
		ReleaseOutputsByTargets(context.Context, applicationimagegeneration.Scope, domainimagegeneration.TargetType, []string, time.Time) error
	}
	runs interface {
		ListRunIDsByTargets(context.Context, applicationimagegeneration.Scope, domainimagegeneration.TargetType, []string) ([]string, error)
	}
	queue *applicationdeletion.Queue
}

func (d resourceGenerationDeletion) DeleteGeneration(ctx context.Context, scope applicationresource.Scope, draftID string, now time.Time) error {
	return d.DeleteTargets(ctx, applicationimagegeneration.Scope{
		TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CallerID: scope.CallerID,
	}, domainimagegeneration.TargetResourceAsset, []string{draftID}, now)
}

func (d resourceGenerationDeletion) DeleteTargets(ctx context.Context, scope applicationimagegeneration.Scope, targetType domainimagegeneration.TargetType, targetIDs []string, now time.Time) error {
	for _, targetID := range targetIDs {
		ids, err := d.runs.ListRunIDsByTargets(ctx, scope, targetType, []string{targetID})
		if err != nil {
			return err
		}
		for _, id := range ids {
			if err = d.queue.Enqueue(ctx, scope.TenantID, imageTaskCleanupJobKind, id, applicationimagegeneration.CancelInput{
				Scope: scope, TargetType: targetType, TargetID: targetID, TaskRunID: id,
			}); err != nil {
				return err
			}
		}
	}
	return d.engine.ReleaseOutputsByTargets(ctx, scope, targetType, targetIDs, now)
}

type canvasNodeVisibility interface {
	HideByCanvasNodes(context.Context, applicationcanvas.Scope, []string, time.Time) error
}

type assetGenerationVisibility struct {
	history canvasNodeVisibility
	video   canvasNodeVisibility
	image   imageGenerationVisibility
}

func (visibility assetGenerationVisibility) HideByCanvasNodes(ctx context.Context, scope applicationcanvas.Scope, ids []string, hiddenAt time.Time) error {
	return errors.Join(
		visibility.history.HideByCanvasNodes(ctx, scope, ids, hiddenAt),
		visibility.video.HideByCanvasNodes(ctx, scope, ids, hiddenAt),
		visibility.image.HideByCanvasNodes(ctx, scope, ids, hiddenAt),
	)
}

type imageGenerationVisibility struct{ cleanup resourceGenerationDeletion }

func (visibility imageGenerationVisibility) HideByCanvasNodes(ctx context.Context, scope applicationcanvas.Scope, ids []string, hiddenAt time.Time) error {
	return visibility.cleanup.DeleteTargets(ctx, applicationimagegeneration.Scope{
		TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CallerID: scope.CallerID,
	}, domainimagegeneration.TargetCanvasNode, ids, hiddenAt)
}

func runPollScheduler(ctx context.Context, scheduler *applicationtask.PollScheduler) {
	config := scheduler.Config()
	slots := make(chan struct{}, config.Concurrency)
	ticker := time.NewTicker(config.ClaimInterval)
	defer ticker.Stop()
	for {
		available := cap(slots) - len(slots)
		if available > 0 {
			claims, err := scheduler.Claim(ctx, available)
			if err != nil && ctx.Err() == nil {
				slog.Error("claim generation tasks", "run_type", config.RunType, "error", err)
			}
			for _, claim := range claims {
				slots <- struct{}{}
				go func(claim domaintask.PollSchedule) {
					defer func() { <-slots }()
					if err := scheduler.ProcessClaim(ctx, claim); err != nil && ctx.Err() == nil {
						slog.Error("process generation task", "run_type", config.RunType, "task_run_id", claim.TaskRunID, "error", err)
					}
				}(claim)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func runDeletionProcessor(ctx context.Context, processor *applicationdeletion.Processor) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		if err := processor.Process(ctx); err != nil && ctx.Err() == nil {
			slog.Error("process deletion cleanup", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func runArchiveCleaner(ctx context.Context, cleaner *applicationcanvasarchive.Cleaner) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		if _, err := cleaner.CleanupDue(ctx, 5*time.Second); err != nil && ctx.Err() == nil {
			slog.Error("clean up expired Canvas archives", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func runAssetGarbageCollector(ctx context.Context, collector *applicationasset.GarbageCollector) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		if _, err := collector.Run(ctx, 30*time.Second); err != nil && ctx.Err() == nil {
			slog.Error("collect unreferenced Canvas assets", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func runQuotaReconciler(ctx context.Context, reconciler *applicationquota.Reconciler) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		runCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		err := reconciler.RunOnce(runCtx, false)
		cancel()
		if err != nil && ctx.Err() == nil {
			slog.Error("reconcile Canvas quota ledger", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func main() {
	if err := run(); err != nil {
		slog.Error("canvas stopped", "error", err)
		os.Exit(1)
	}
}
func run() error {
	cfg, err := bootstrap.Load()
	if err != nil {
		return err
	}
	shutdownTelemetry, err := observability.Configure(context.Background(), "canvas")
	if err != nil {
		return err
	}
	defer func() {
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = shutdownTelemetry(shutdown)
	}()
	db, err := bootstrap.Connect(cfg)
	if err != nil {
		return err
	}
	sql, err := db.DB()
	if err != nil {
		return err
	}
	defer sql.Close()
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	redisOptions, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		return err
	}
	redisClient := redis.NewClient(redisOptions)
	defer redisClient.Close()
	if err = redisClient.Ping(ctx).Err(); err != nil {
		return err
	}
	log := zap.NewNop()
	nodeRepository := canvasnodepersistence.NewRepository(db)
	canvasRepository := canvaspersistence.NewRepository(db)
	taskRepository := taskpersistence.NewRepository(db)
	videoRepository := videogenerationpersistence.NewRepository(db)
	imageRepository := imagegenerationpersistence.NewRepository(db)
	storyboardRepository := canvasstoryboardpersistence.NewRepository(db)
	assetRepository := assetpersistence.NewRepository(db)
	reviewRepository := benefitpackagepersistence.NewRepository(db)
	projectRepository := projectpersistence.NewRepository(db)
	resourceRepository := resourcepersistence.NewRepository(db)
	resourceGenerationRepository := resourceassetgenerationpersistence.NewRepository(db)
	projectUsageRepository := projectusagepersistence.NewRepository(db)
	projectUsageCalls := applicationprojectusage.NewCallRecorder(projectUsageRepository, utcClock{})
	projectUsageFinalizer := applicationprojectusage.NewFinalizer(projectUsageRepository, utcClock{})
	deletionRepository := deletionpersistence.NewRepository(db)
	deletionQueue := applicationdeletion.NewQueue(deletionRepository)
	quotaRepository := quotapersistence.NewRepository(db, log)
	quotaService := applicationquota.NewService(applicationquota.Modes{}, unavailableQuotaLimits{}, quotaRepository, utcClock{})
	go runQuotaReconciler(ctx, applicationquota.NewReconciler(quotaRepository, utcClock{}))
	providers := &admin.Directory{URL: cfg.AdminServiceURL, Token: cfg.InternalToken}
	models := modelcatalog.New(providers)
	storageClient := &storage.Client{
		URL: cfg.KnowledgeServiceURL, Token: cfg.InternalToken,
	}
	artifacts := artifact.New(storageClient, cfg.PublicGatewayURL)
	coverImages := coverimagestore.New(storageClient, uuidGenerator{}, cfg.PublicGatewayURL)
	projectUsageExporter := applicationprojectusage.NewExporter(projectUsageRepository, artifacts, uuidGenerator{}, utcClock{})
	transactions := persistencetransaction.New(db)
	archiveRepository := canvasarchivepersistence.NewRepository(db)
	executorClient := &executorclient.Client{
		URL: cfg.ExecutorServiceURL, Token: cfg.InternalToken,
	}
	archiveWorkflows := executorclient.NewArchiveWorkflowStore(db, executorClient)
	archiveService := applicationcanvasarchive.NewService(
		archiveRepository, archiveRepository, taskRepository, archiveWorkflows, transactions, uuidGenerator{}, utcClock{},
		applicationcanvasarchive.WithCanvasAccessValidator(archiveCanvasAccess{canvases: canvasRepository}),
		applicationcanvasarchive.WithCancellation(taskRepository, archiveWorkflows),
		applicationcanvasarchive.WithStorageQuota(quotaService),
	)
	archiveWorkflows.Bind(archiveService)
	archiveRuntime := canvasarchivemedia.NewRuntime(
		archiveService, archiveRepository, taskRepository, transactions, storageClient, utcClock{}, "",
	)
	go archiveWorkflows.Run(ctx)
	archiveObjects := canvasarchivemedia.NewObjectStore(db, storageClient)
	go runArchiveCleaner(ctx, applicationcanvasarchive.NewCleaner(archiveRepository, archiveObjects, quotaService, utcClock{}))
	executions := applicationtask.NewActiveExecutions()
	assetService := applicationasset.NewService(
		assetRepository, assetpersistence.NewOwnerResolver(db), artifacts, uuidGenerator{}, utcClock{},
		applicationasset.WithReferenceStore(assetRepository),
	)
	reviewCleanup := applicationpackage.NewReviewCleanupService(reviewRepository, taskRepository, transactions, utcClock{})
	assetService = applicationasset.NewService(
		assetRepository, assetpersistence.NewOwnerResolver(db), artifacts, uuidGenerator{}, utcClock{},
		applicationasset.WithReferenceStore(assetRepository),
		applicationasset.WithReviewReader(reviewRepository),
		applicationasset.WithReviewCleanup(reviewCleanup, nil),
		applicationasset.WithStorageQuota(quotaService, transactions),
	)
	assetGarbageCollector := applicationasset.NewGarbageCollector(
		assetRepository, assetRepository, artifacts, utcClock{}, 24*time.Hour, 7*24*time.Hour,
		applicationasset.WithGarbageCollectionReviewCleanup(reviewCleanup, nil),
		applicationasset.WithGarbageCollectionStorageQuota(quotaService),
	)
	go runAssetGarbageCollector(ctx, assetGarbageCollector)
	reviews := applicationpackage.NewReviewService(
		reviewRepository, assetService, artifacts, resourceRepository, providers, taskRepository, transactions, uuidGenerator{}, utcClock{},
	)
	reviewCleanupProcessor := applicationpackage.NewReviewCleanupProcessor(reviewRepository, providers, transactions, utcClock{}, 8)
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			result := reviewCleanupProcessor.ProcessDue(ctx, 500*time.Millisecond)
			if result.RoundError != nil {
				slog.Error("process asset review cleanup", "error", result.RoundError)
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	providerClient := providerclient.New(providers)
	projectStatistics := applicationprojectstatistics.NewService(
		projectstatisticspersistence.New(db), nil,
	)
	canvasStatistics := applicationcanvas.NewCanvasStatisticsService(
		canvasstatisticspersistence.New(db), nil,
	)
	resourceDrafts := applicationresourceassetgeneration.NewDraftService(
		resourceGenerationRepository, assetService, resourceRepository, transactions, assetService, utcClock{},
		applicationresourceassetgeneration.WithDraftAssetMaterializer(assetService),
	)
	resourceImageTarget := applicationresourceassetgeneration.NewTargetHandler(
		resourceGenerationRepository, assetService, resourceRepository,
		applicationresourceassetgeneration.WithTargetReviewCleanup(assetService),
		applicationresourceassetgeneration.WithTargetAssetReferences(assetService),
	)
	canvasImageTarget := applicationcanvasimagegeneration.NewTargetHandler(nodeRepository)
	imageTargets, err := applicationimagegeneration.NewTargetRegistry(resourceImageTarget, canvasImageTarget)
	if err != nil {
		return err
	}
	imageEngine := applicationimagegeneration.NewEngine(
		imageTargets, imageRepository, taskRepository, transactions, uuidGenerator{}, utcClock{}, executions, nil, assetService,
		applicationimagegeneration.WithProjectUsage(projectUsageCalls, projectUsageFinalizer),
	)
	imageProcessor := applicationimagegeneration.NewProcessor(
		imageRepository, taskRepository, assetService, artifacts, provider.NewImageProvider(providerClient), artifacts,
		transactions, utcClock{}, assetService, imageTargets,
		applicationimagegeneration.WithProjectUsage(projectUsageCalls, projectUsageFinalizer),
	)
	resourceGenerationCleanup := resourceGenerationDeletion{engine: imageEngine, runs: imageRepository, queue: deletionQueue}
	frameTerminalCoordinator, err := applicationtask.NewTerminalCoordinator(
		taskRepository,
		applicationvideogeneration.NewFirstLastFrameParentAggregator(projectUsageFinalizer),
	)
	if err != nil {
		return err
	}
	frames := applicationfirstlastframe.NewService(
		videoRepository, taskRepository, transactions, utcClock{},
		applicationfirstlastframe.WithAssets(assetService),
		applicationfirstlastframe.WithAssetReferences(assetService),
		applicationfirstlastframe.WithTerminalCoordinator(frameTerminalCoordinator),
	)
	frameRuntime := firstlastframemedia.NewRuntime(
		frames, taskRepository, transactions, storageClient, utcClock{}, "",
	)
	frameWorkflows := executorclient.NewFirstLastFrameWorkflowStore(db, executorClient, frames, taskRepository)
	go frameWorkflows.Run(ctx)
	videos := applicationvideogeneration.NewService(
		nodeRepository, taskRepository, taskRepository, videoRepository,
		provider.NewCanvasNodeVideoProvider(providerClient), artifacts, artifacts, taskRepository,
		transactions, canvasStatistics, uuidGenerator{}, utcClock{},
		applicationvideogeneration.WithModelCatalog(models),
		applicationvideogeneration.WithFrameAssets(assetService),
		applicationvideogeneration.WithGenerationAssets(assetService),
		applicationvideogeneration.WithCanvasResourceAssets(nodeRepository),
		applicationvideogeneration.WithProjectStatistics(projectStatistics),
		applicationvideogeneration.WithAssetReferences(assetService),
		applicationvideogeneration.WithProjectUsageCallRecorder(projectUsageCalls),
		applicationvideogeneration.WithProjectUsageFinalizer(projectUsageFinalizer),
	)
	textGenerations := applicationcanvastextgeneration.NewService(
		nodeRepository,
		canvastextgenerationredis.New(redisClient),
		canvastextgenerationpersistence.NewRepository(db),
		taskRepository,
		taskRepository,
		executions,
		transactions,
		uuidGenerator{},
		utcClock{},
		models,
		provider.NewTextProvider(providerClient),
		applicationcanvastextgeneration.WithProjectUsage(projectUsageCalls, projectUsageFinalizer),
		applicationcanvastextgeneration.WithGenerationInputs(nodeRepository, assetService, artifacts),
	)
	generations := applicationcanvasgeneration.NewService(
		nodeRepository, imageEngine, videos, textGenerations, assetService,
		applicationcanvasgeneration.WithImageModelCatalog(models),
		applicationcanvasgeneration.WithGenerationStateReaders(nodeRepository, taskRepository, videoRepository),
	)
	nodes := applicationcanvas.NewCanvasNodeService(
		nodeRepository, uuidGenerator{}, utcClock{},
		applicationcanvas.WithMutationDependencies(transactions, canvasstatisticspersistence.New(db)),
		applicationcanvas.WithCanvasStatisticsProjector(canvasStatistics),
		applicationcanvas.WithStoryboardSplitter(provider.NewStoryboardSplitter(providerClient, log)),
		applicationcanvas.WithPromptAssetMatcher(provider.NewPromptAssetMatcher(providerClient)),
		applicationcanvas.WithAssetMatchTasks(nodeRepository, taskRepository, taskRepository, taskRepository),
		applicationcanvas.WithModelCatalog(models),
		applicationcanvas.WithActiveGenerationCanceller(generations),
		applicationcanvas.WithTaskVisibility(assetGenerationVisibility{
			history: deletionRepository,
			video:   videos,
			image:   imageGenerationVisibility{cleanup: resourceGenerationCleanup},
		}, nil),
		applicationcanvas.WithSelectedOutputPreviewer(assetService, nil),
		applicationcanvas.WithCanvasNodeAssetReader(assetService),
		applicationcanvas.WithCanvasNodeProjectStatistics(projectStatistics),
		applicationcanvas.WithStoryboardAssetAutoAttach(nodeRepository, nil),
		applicationcanvas.WithCanvasNodeAssetReferences(assetService),
		applicationcanvas.WithCanvasAssetResolver(assetService),
		applicationcanvas.WithCanvasNodeUploadCreation(canvasRepository, assetService),
		applicationcanvas.WithCanvasResourceResolvers(nodeRepository, nodeRepository),
		applicationcanvas.WithCanvasResourceAssetResolvers(nodeRepository, nodeRepository),
		applicationcanvas.WithCanvasNodeDeletionQueue(deletionQueue),
	)
	storyboards := applicationcanvas.NewStoryboardService(
		nodes, canvasstoryboardredis.New(redisClient), storyboardRepository, taskRepository, taskRepository,
		executions, transactions, uuidGenerator{}, utcClock{},
		applicationcanvas.WithStoryboardCanvasAccess(canvasRepository),
		applicationcanvas.WithStoryboardModelCallLedger(usageobserver.NewStoryboardObserver(projectUsageCalls)),
		applicationcanvas.WithStoryboardProjectUsage(projectUsageCalls, projectUsageFinalizer),
	)
	assets := applicationcanvas.NewCanvasNodeAssetService(
		nodeRepository, assetService, assetService, nil, nodeRepository,
		applicationcanvas.WithCanvasAssetCreation(canvasRepository, assetService),
	)
	resourceService := applicationresource.NewService(
		resourceRepository, resourcepersistence.NewProjectResolver(db), uuidGenerator{}, utcClock{},
		applicationresource.WithAssetMutations(assetService, transactions),
		applicationresource.WithBlobAssetCreation(assetService, transactions),
		applicationresource.WithAssetImport(assetService, transactions),
		applicationresource.WithAssetReferenceTracker(assetService),
		applicationresource.WithCanvasNodeAssetBinding(nodeRepository),
		applicationresource.WithImageGenerationDrafts(resourceGenerationRepository, transactions),
		applicationresource.WithGenerationDeletion(resourceGenerationCleanup),
		applicationresource.WithProjectStatistics(projectStatistics),
	)
	resourceGenerations := applicationresourceassetgeneration.NewService(
		resourceService, resourceDrafts, imageEngine,
		applicationresourceassetgeneration.WithImageModelCatalog(models),
		applicationresourceassetgeneration.WithUploadedReferenceReader(assetService),
	)
	nodeHandler := maturehttp.NewCanvasNodeHandler(nodes, assets, generations, storyboards, textGenerations)
	resourceHandler := maturehttp.NewResourceHandler(resourceService, assetService, resourceGenerations)
	memberAccess := projectaccesspersistence.NewChecker(db, redisClient, log)
	access := applicationprojectaccess.NewAuthorizer(gatewayProjectPermissions{}, memberAccess)
	canvasService := applicationcanvas.NewService(
		canvasRepository, coverImages, uuidGenerator{}, utcClock{},
		applicationcanvas.WithCanvasNodes(nodes, transactions),
		applicationcanvas.WithCanvasDeletionPreparer(deletionRepository),
		applicationcanvas.WithFallbackCovers(nodeRepository, assetService, nil),
		applicationcanvas.WithProjectStatistics(projectStatistics),
		applicationcanvas.WithCanvasDeletionQueue(deletionQueue),
		applicationcanvas.WithStorageQuota(quotaService, transactions),
	)
	projectService := applicationproject.NewService(
		projectRepository, coverImages, uuidGenerator{}, utcClock{},
		applicationproject.WithProjectChildCleanup(
			applicationprojectcleanup.NewService(canvasService, assetService, resourceService),
			nil,
		),
		applicationproject.WithProjectUsagePolicyGateway(projectusagepolicypersistence.New(db)),
		applicationproject.WithModelPermissionGateway(models),
		applicationproject.WithMemberCacheInvalidator(memberAccess),
		applicationproject.WithDeletionQueue(deletionQueue),
		applicationproject.WithQuota(quotaService, transactions),
		applicationproject.WithStorageQuota(quotaService, transactions),
	)
	coverCleaner := applicationcoverimage.NewCleaner(coverImages, quotaService)
	deletionProcessor := applicationdeletion.NewProcessor(deletionRepository, map[string]applicationdeletion.Handler{
		imageTaskCleanupJobKind: func(ctx context.Context, data json.RawMessage) error {
			var input applicationimagegeneration.CancelInput
			if err := json.Unmarshal(data, &input); err != nil {
				return err
			}
			return imageEngine.Cancel(ctx, input)
		},
		applicationcanvas.CanvasTaskCleanupJobKind: func(ctx context.Context, data json.RawMessage) error {
			var input applicationcanvas.CanvasTaskCleanupPayload
			if err := json.Unmarshal(data, &input); err != nil {
				return err
			}
			switch input.RunType {
			case domaintask.RunTypeCanvasStoryboardGeneration:
				return storyboards.CancelDeletedCanvasTask(ctx, input.Scope, input.ProjectID, input.CanvasID, input.TaskRunID)
			case domaintask.RunTypeCanvasVideoArchiveExport:
				return archiveService.Cancel(ctx, applicationcanvasarchive.GetInput{
					Scope: applicationcanvasarchive.Scope{
						TenantID: input.Scope.TenantID, WorkspaceID: input.Scope.WorkspaceID, CallerID: input.Scope.CallerID,
					},
					ProjectID: input.ProjectID, CanvasID: input.CanvasID, TaskRunID: input.TaskRunID,
				})
			default:
				return errors.New("unsupported deleted canvas task type")
			}
		},
		applicationcanvas.NodeCleanupJobKind: func(ctx context.Context, data json.RawMessage) error {
			var input applicationcanvas.NodeCleanupPayload
			if err := json.Unmarshal(data, &input); err != nil {
				return err
			}
			return nodes.CleanupDeletedNode(ctx, input)
		},
		applicationcanvas.CanvasCleanupJobKind: func(ctx context.Context, data json.RawMessage) error {
			var input applicationcanvas.CanvasCleanupPayload
			if err := json.Unmarshal(data, &input); err != nil {
				return err
			}
			return canvasService.CleanupDeletedCanvas(ctx, input)
		},
		applicationproject.CleanupJobKind: func(ctx context.Context, data json.RawMessage) error {
			var input applicationproject.CleanupPayload
			if err := json.Unmarshal(data, &input); err != nil {
				return err
			}
			return projectService.CleanupDeleted(ctx, input)
		},
		applicationcoverimage.CleanupJobKind: func(ctx context.Context, data json.RawMessage) error {
			var registration applicationcoverimage.Registration
			if err := json.Unmarshal(data, &registration); err != nil {
				return err
			}
			return coverCleaner.Cleanup(ctx, registration)
		},
	})
	go runDeletionProcessor(ctx, deletionProcessor)
	processors := []applicationtask.PollProcessor{videos, imageProcessor, textGenerations, storyboards, nodes, reviews}
	for _, processor := range processors {
		scheduler, schedulerErr := applicationtask.NewRunTypePollScheduler(
			taskRepository, taskRepository, processor, executions, utcClock{}, applicationtask.PollPoolConfig{
				RunType: processor.RunType(), Concurrency: 4, ClaimInterval: time.Second,
				Lease: 30 * time.Second, Heartbeat: 10 * time.Second, ExecutionTimeout: 10 * time.Minute,
			},
		)
		if schedulerErr != nil {
			return schedulerErr
		}
		go runPollScheduler(ctx, scheduler)
	}
	handler := openapi.NewRouter(
		cfg.InternalServiceTokens, maturehttp.NewProjectHandler(projectService), maturehttp.NewProjectUsageHandler(projectUsageExporter), maturehttp.NewCanvasHandler(canvasService), nodeHandler, resourceHandler, maturehttp.NewAssetHandler(reviews),
		maturehttp.NewCanvasArchiveHandler(archiveService, archiveRuntime),
		func(ctx context.Context, taskRunID string) (any, error) {
			return archiveRuntime.Execute(ctx, taskRunID)
		},
		func(ctx context.Context, taskRunID string) (any, error) {
			return frameRuntime.Execute(ctx, taskRunID)
		},
		func(ctx context.Context, reader io.Reader) (string, int64, error) {
			return artifacts.UploadBlob(ctx, "", "", reader)
		},
		func(ctx context.Context) error {
			return errors.Join(sql.PingContext(ctx), redisClient.Ping(ctx).Err())
		},
		access,
	)
	handler = otelhttp.NewHandler(handler, "canvas", otelhttp.WithFilter(func(request *http.Request) bool {
		switch request.URL.Path {
		case "/livez", "/readyz", "/healthz":
			return false
		default:
			return true
		}
	}))
	server := &http.Server{Addr: ":" + cfg.Port, Handler: handler, ReadHeaderTimeout: 10 * time.Second}
	done := make(chan error, 1)
	go func() { done <- server.ListenAndServe() }()
	select {
	case err := <-done:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	}
	return nil
}
