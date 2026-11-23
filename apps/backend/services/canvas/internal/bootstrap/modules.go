package bootstrap

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5/pgxpool"
	"log/slog"
	"net/http"
	"time"

	maturehttp "github.com/example/monorepo/canvas/internal/api/handler"
	mcpapi "github.com/example/monorepo/canvas/internal/api/mcp"
	"github.com/example/monorepo/canvas/internal/api/openapi"
	rpcapi "github.com/example/monorepo/canvas/internal/api/rpc"
	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	applicationassetclaim "github.com/example/monorepo/canvas/internal/application/assetclaim"
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
	applicationuploadintent "github.com/example/monorepo/canvas/internal/application/uploadintent"
	applicationvideogeneration "github.com/example/monorepo/canvas/internal/application/videogeneration"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	"github.com/example/monorepo/canvas/internal/infrastructure/admin"
	"github.com/example/monorepo/canvas/internal/infrastructure/artifact"
	"github.com/example/monorepo/canvas/internal/infrastructure/canvasstoryboardredis"
	coverimagestore "github.com/example/monorepo/canvas/internal/infrastructure/coverimage"
	canvasarchivemedia "github.com/example/monorepo/canvas/internal/infrastructure/media/canvasarchive"
	firstlastframemedia "github.com/example/monorepo/canvas/internal/infrastructure/media/firstlastframe"
	assetpersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/asset"
	assetclaimpersistence "github.com/example/monorepo/canvas/internal/infrastructure/persistence/assetclaim"
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
	"github.com/example/monorepo/canvas/internal/infrastructure/storageclient"
	"github.com/example/monorepo/canvas/internal/infrastructure/usageobserver"
	innerruntime "github.com/example/monorepo/inner-api-go/runtime"
	"github.com/redis/go-redis/v9"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

func buildModules(
	ctx context.Context,
	role processRole,
	cfg Config,
	db *persistencetransaction.Store,
	pool *pgxpool.Pool,
	redisClient *redis.Client,
	rpcService **rpcapi.Server,
) (http.Handler, error) {
	serviceName := "canvas"
	if role == roleWorker {
		serviceName = "canvas-worker"
	}
	log := slog.Default()
	nodeRepository := canvasnodepersistence.NewRepository(db)
	canvasJournal := canvasnodepersistence.NewEventJournal(db, nodeRepository)
	canvasJournal.Register()
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
	if role == roleWorker {
		go runQuotaReconciler(ctx, applicationquota.NewReconciler(quotaRepository, utcClock{}))
	}
	adminConnection, err := innerruntime.DialContext(ctx, cfg.AdminRPCTarget, innerruntime.ClientOptions{Caller: "canvas", DefaultTimeout: 15 * time.Second})
	if err != nil {
		return nil, err
	}
	go func() {
		<-ctx.Done()
		_ = adminConnection.Close()
	}()
	providers := admin.New(adminConnection)
	models := modelcatalog.New(providers)
	storageConnection, err := innerruntime.DialContext(ctx, cfg.StorageRPCTarget, innerruntime.ClientOptions{Caller: "canvas", DefaultTimeout: 5 * time.Minute})
	if err != nil {
		return nil, err
	}
	go func() {
		<-ctx.Done()
		_ = storageConnection.Close()
	}()
	storageClient := storageclient.New(storageConnection)
	uploadIntents := applicationuploadintent.New(storageClient)
	claimIntents := assetclaimpersistence.NewRepository(db)
	if role == roleWorker {
		go runAssetClaimRelay(ctx, applicationassetclaim.NewRelay(claimIntents, storageClient, utcClock{}))
	}
	artifacts := artifact.New(storageClient, cfg.PublicGatewayURL)
	coverImages := coverimagestore.New(storageClient, claimIntents, utcClock{}, cfg.PublicGatewayURL)
	projectUsageExporter := applicationprojectusage.NewExporter(projectUsageRepository, artifacts, uuidGenerator{}, utcClock{})
	transactions := db
	archiveRepository := canvasarchivepersistence.NewRepository(db)
	archiveService := applicationcanvasarchive.NewService(
		archiveRepository, archiveRepository, taskRepository, taskRepository, transactions, uuidGenerator{}, utcClock{},
		applicationcanvasarchive.WithCanvasAccessValidator(archiveCanvasAccess{canvases: canvasRepository}),
		applicationcanvasarchive.WithCancellation(taskRepository, taskRepository),
		applicationcanvasarchive.WithStorageQuota(quotaService),
		applicationcanvasarchive.WithClaimIntents(claimIntents),
	)
	archiveRuntime := canvasarchivemedia.NewRuntime(
		archiveService, archiveRepository, taskRepository, transactions, storageClient, utcClock{}, "",
	)
	if role == roleWorker {
		go runArchiveCleaner(ctx, applicationcanvasarchive.NewCleaner(archiveRepository, claimIntents, transactions, quotaService, utcClock{}))
	}
	executions := applicationtask.NewActiveExecutions()
	assetService := applicationasset.NewService(
		assetRepository, assetpersistence.NewOwnerResolver(db), artifacts, uuidGenerator{}, utcClock{},
		applicationasset.WithReferenceStore(assetRepository),
		applicationasset.WithClaimIntents(claimIntents, transactions),
		applicationasset.WithUploadIntents(uploadIntents),
	)
	reviewCleanup := applicationpackage.NewReviewCleanupService(reviewRepository, taskRepository, transactions, utcClock{})
	assetService = applicationasset.NewService(
		assetRepository, assetpersistence.NewOwnerResolver(db), artifacts, uuidGenerator{}, utcClock{},
		applicationasset.WithReferenceStore(assetRepository),
		applicationasset.WithReviewReader(reviewRepository),
		applicationasset.WithReviewCleanup(reviewCleanup, nil),
		applicationasset.WithStorageQuota(quotaService, transactions),
		applicationasset.WithClaimIntents(claimIntents, transactions),
		applicationasset.WithUploadIntents(uploadIntents),
	)
	reviews := applicationpackage.NewReviewService(
		reviewRepository, assetService, artifacts, resourceRepository, providers, taskRepository, transactions, uuidGenerator{}, utcClock{},
	)
	reviewCleanupProcessor := applicationpackage.NewReviewCleanupProcessor(reviewRepository, providers, transactions, utcClock{}, 8)
	if role == roleWorker {
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
	}
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
		return nil, err
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
		return nil, err
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
	nodeHandler := maturehttp.NewCanvasNodeHandler(nodes, assets, generations, textGenerations, storyboards)
	nodeHandler.SetStream(canvasJournal)
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
		applicationcanvas.WithUploadIntents(uploadIntents),
	)
	nodeHandler.SetCanvasMetadata(canvasService)
	if role == roleServer && rpcService != nil {
		*rpcService = rpcapi.New(nodeHandler, access)
	}
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
		applicationproject.WithUploadIntents(uploadIntents),
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
	localAsyncCoordinator := applicationtask.NewAsyncExecutionCoordinator(
		taskRepository,
		taskRepository,
		transactions,
		[]applicationtask.AsyncExecutionStarter{
			applicationcanvasarchive.NewAsyncExecutionStarter(archiveRepository, taskRepository, transactions),
			applicationfirstlastframe.NewAsyncExecutionStarter(taskRepository, transactions),
		},
		uuidGenerator{},
		utcClock{},
	)
	localAsyncWorker := applicationtask.NewLocalAsyncWorker(
		taskRepository,
		localAsyncCoordinator,
		[]applicationtask.LocalAsyncExecutor{
			localAsyncExecutor{
				runType: domaintask.RunTypeCanvasVideoArchiveExport,
				execute: func(runCtx context.Context, taskRunID string) error {
					_, executeErr := archiveRuntime.Execute(runCtx, taskRunID)
					return executeErr
				},
				fail: archiveService.CommitFailure,
			},
			localAsyncExecutor{
				runType: domaintask.RunTypeCanvasNodeVideoFirstLastFrameExtraction,
				execute: func(runCtx context.Context, taskRunID string) error {
					_, executeErr := frameRuntime.Execute(runCtx, taskRunID)
					return executeErr
				},
				fail: frames.CommitFailure,
			},
		},
		utcClock{},
	)
	processors := []applicationtask.PollProcessor{videos, imageProcessor, textGenerations, storyboards, nodes, reviews}
	if role == roleWorker {
		go runDeletionProcessor(ctx, deletionProcessor)
		go runLocalAsyncWorker(ctx, localAsyncWorker)
		go func() {
			ticker := time.NewTicker(time.Hour)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					if err := canvasJournal.Prune(ctx); err != nil {
						slog.Error("prune canvas events", "error", err)
					}
				}
			}
		}()
		for _, processor := range processors {
			scheduler, schedulerErr := applicationtask.NewRunTypePollScheduler(
				taskRepository, taskRepository, processor, executions, utcClock{}, applicationtask.PollPoolConfig{
					RunType: processor.RunType(), Concurrency: 4, ClaimInterval: time.Second,
					Lease: 30 * time.Second, Heartbeat: 10 * time.Second, ExecutionTimeout: 10 * time.Minute,
				},
			)
			if schedulerErr != nil {
				return nil, schedulerErr
			}
			go runPollScheduler(ctx, scheduler)
		}
	}
	handler := openapi.NewRouter(
		maturehttp.NewProjectHandler(projectService), maturehttp.NewProjectUsageHandler(projectUsageExporter), maturehttp.NewCanvasHandler(canvasService), nodeHandler, resourceHandler, maturehttp.NewAssetHandler(reviews, uploadIntents),
		maturehttp.NewCanvasArchiveHandler(archiveService, archiveRuntime),
		func(ctx context.Context) error {
			return errors.Join(pool.Ping(ctx), redisClient.Ping(ctx).Err())
		},
		access,
	)
	if role == roleServer {
		serverMux := http.NewServeMux()
		serverMux.Handle("/mcp", mcpapi.NewHandler(nodeHandler, access, cfg.RuntimeCallerToken))
		serverMux.Handle("/", handler)
		handler = serverMux
	}
	if role == roleWorker {
		workerMux := http.NewServeMux()
		workerMux.HandleFunc("/livez", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"ok"}`))
		})
		workerMux.HandleFunc("/readyz", func(w http.ResponseWriter, request *http.Request) {
			readyCtx, readyCancel := context.WithTimeout(request.Context(), 3*time.Second)
			defer readyCancel()
			if err := errors.Join(pool.Ping(readyCtx), redisClient.Ping(readyCtx).Err()); err != nil {
				http.Error(w, `{"status":"degraded"}`, http.StatusServiceUnavailable)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"status":"ok"}`))
		})
		handler = workerMux
	}
	handler = otelhttp.NewHandler(handler, serviceName, otelhttp.WithFilter(func(request *http.Request) bool {
		switch request.URL.Path {
		case "/livez", "/readyz", "/healthz":
			return false
		default:
			return true
		}
	}))
	return handler, nil
}
