package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	maturehttp "github.com/example/monorepo/canvas/internal/api/handler"
	"github.com/example/monorepo/canvas/internal/api/openapi"
	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	applicationbasicconfig "github.com/example/monorepo/canvas/internal/application/basicconfig"
	applicationcanvas "github.com/example/monorepo/canvas/internal/application/canvas"
	applicationcanvasgeneration "github.com/example/monorepo/canvas/internal/application/canvasgeneration"
	applicationcanvasimagegeneration "github.com/example/monorepo/canvas/internal/application/canvasimagegeneration"
	applicationdeletion "github.com/example/monorepo/canvas/internal/application/deletion"
	applicationimagegeneration "github.com/example/monorepo/canvas/internal/application/imagegeneration"
	applicationproject "github.com/example/monorepo/canvas/internal/application/project"
	applicationprojectcleanup "github.com/example/monorepo/canvas/internal/application/projectcleanup"
	applicationprojectstatistics "github.com/example/monorepo/canvas/internal/application/projectstatistics"
	applicationprojectusage "github.com/example/monorepo/canvas/internal/application/projectusage"
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
	assetpersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/asset"
	canvaspersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/canvas"
	canvasnodepersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/canvasnode"
	canvasstatisticspersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/canvasstatistics"
	canvasstoryboardpersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/canvasstoryboard"
	defaultmodelpersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/defaultmodel"
	deletionpersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/deletion"
	imagegenerationpersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/imagegeneration"
	projectpersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/project"
	projectaccesspersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/projectaccess"
	projectstatisticspersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/projectstatistics"
	projectusagepersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/projectusage"
	projectusagepolicypersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/projectusagepolicy"
	resourcepersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/resource"
	resourceassetgenerationpersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/resourceassetgeneration"
	taskpersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/task"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
	videogenerationpersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/videogeneration"
	"github.com/example/monorepo/canvas/internal/infrastructure/provider"
	platformaigwproxy "github.com/example/monorepo/canvas/internal/infrastructure/provider/client"
	"github.com/example/monorepo/canvas/internal/infrastructure/providercatalog"
	"github.com/example/monorepo/canvas/internal/infrastructure/storage"
	"github.com/example/monorepo/canvas/internal/infrastructure/usageobserver"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
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
	projectRepository := projectpersistence.NewRepository(db)
	resourceRepository := resourcepersistence.NewRepository(db)
	resourceGenerationRepository := resourceassetgenerationpersistence.NewRepository(db)
	projectUsageRepository := projectusagepersistence.NewRepository(db)
	projectUsageCalls := applicationprojectusage.NewCallRecorder(projectUsageRepository, utcClock{})
	projectUsageFinalizer := applicationprojectusage.NewFinalizer(projectUsageRepository, utcClock{})
	deletionRepository := deletionpersistence.NewRepository(db)
	deletionQueue := applicationdeletion.NewQueue(deletionRepository)
	providers := &admin.Directory{URL: bootstrap.Env("ADMIN_SERVICE_URL", "http://localhost:8001"), Token: cfg.InternalToken}
	models := modelcatalog.New(providers)
	artifacts := artifact.New(&storage.Client{
		URL: bootstrap.Env("KNOWLEDGE_SERVICE_URL", "http://localhost:8010"), Token: cfg.InternalToken,
	}, cfg.PublicGatewayURL)
	transactions := persistencetransaction.New(db)
	executions := applicationtask.NewActiveExecutions()
	assetService := applicationasset.NewService(
		assetRepository, assetpersistence.NewOwnerResolver(db), artifacts, uuidGenerator{}, utcClock{},
		applicationasset.WithReferenceStore(assetRepository),
	)
	providerClient := platformaigwproxy.New(providers)
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
		imageRepository, taskRepository, assetService, artifacts, aigw.NewImageProvider(providerClient), artifacts,
		transactions, utcClock{}, assetService, imageTargets,
		applicationimagegeneration.WithProjectUsage(projectUsageCalls, projectUsageFinalizer),
	)
	resourceGenerationCleanup := resourceGenerationDeletion{engine: imageEngine, runs: imageRepository, queue: deletionQueue}
	videos := applicationvideogeneration.NewService(
		nodeRepository, taskRepository, taskRepository, videoRepository,
		aigw.NewCanvasNodeVideoProvider(providerClient), artifacts, artifacts,
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
	generations := applicationcanvasgeneration.NewService(
		nodeRepository, imageEngine, videos, assetService,
		applicationcanvasgeneration.WithImageModelCatalog(models),
		applicationcanvasgeneration.WithGenerationStateReaders(nodeRepository, taskRepository, videoRepository),
	)
	nodes := applicationcanvas.NewCanvasNodeService(
		nodeRepository, uuidGenerator{}, utcClock{},
		applicationcanvas.WithMutationDependencies(transactions, canvasstatisticspersistence.New(db)),
		applicationcanvas.WithCanvasStatisticsProjector(canvasStatistics),
		applicationcanvas.WithStoryboardSplitter(aigw.NewStoryboardSplitter(providerClient, log)),
		applicationcanvas.WithPromptAssetMatcher(aigw.NewPromptAssetMatcher(providerClient)),
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
		applicationcanvas.WithStoryboardModelCallLedger(usageobserver.NewStoryboardObserver(projectUsageCalls)),
		applicationcanvas.WithStoryboardProjectUsage(projectUsageCalls, projectUsageFinalizer),
		applicationcanvas.WithStoryboardCanvasAccess(canvasRepository),
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
	basicConfigHandler := maturehttp.NewBasicConfigHandler(
		applicationbasicconfig.NewService(defaultmodelpersistence.NewRepository(db), models),
	)
	nodeHandler := maturehttp.NewCanvasNodeHandler(nodes, assets, generations, storyboards)
	resourceHandler := maturehttp.NewResourceHandler(resourceService, assetService, resourceGenerations)
	access := projectaccesspersistence.NewChecker(db, redisClient, log)
	canvasService := applicationcanvas.NewService(
		canvasRepository, nil, uuidGenerator{}, utcClock{},
		applicationcanvas.WithCanvasNodes(nodes, transactions),
		applicationcanvas.WithCanvasDeletionPreparer(deletionRepository),
		applicationcanvas.WithFallbackCovers(nodeRepository, assetService, nil),
		applicationcanvas.WithProjectStatistics(projectStatistics),
		applicationcanvas.WithCanvasDeletionQueue(deletionQueue),
	)
	projectService := applicationproject.NewService(
		projectRepository, nil, uuidGenerator{}, utcClock{},
		applicationproject.WithProjectChildCleanup(
			applicationprojectcleanup.NewService(canvasService, assetService, resourceService),
			nil,
		),
		applicationproject.WithProjectUsagePolicyGateway(projectusagepolicypersistence.New(db)),
		applicationproject.WithMemberCacheInvalidator(access),
		applicationproject.WithDeletionQueue(deletionQueue),
	)
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
			if input.RunType != domaintask.RunTypeCanvasStoryboardGeneration {
				return errors.New("unsupported deleted canvas task type")
			}
			return storyboards.Cancel(ctx, input.Scope, input.ProjectID, input.CanvasID, input.TaskRunID)
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
	})
	go runDeletionProcessor(ctx, deletionProcessor)
	processors := []applicationtask.PollProcessor{videos, storyboards, imageProcessor, nodes}
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
	server := &http.Server{Addr: ":" + cfg.Port, Handler: openapi.NewRouter(
		basicConfigHandler, maturehttp.NewProjectHandler(projectService), maturehttp.NewCanvasHandler(canvasService), nodeHandler, resourceHandler, access,
	), ReadHeaderTimeout: 10 * time.Second}
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
