package benefitpackage

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"net/url"
	"strings"
	"sync"
	"time"

	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	applicationtask "github.com/example/monorepo/canvas/internal/application/task"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

const (
	reviewPollInterval                = 3 * time.Second
	reviewDeadline                    = 24 * time.Hour
	reviewSubmissionDeadline          = 10 * time.Minute
	reviewSubmissionBackoff           = 5 * time.Second
	reviewSubmissionMaxDelay          = time.Minute
	assetReviewRateLimitWaitingReason = "Ark 限流等待中"
	assetReviewSharedPoolQuotaReason  = "方舟账号权益或素材额度不足，请检查套餐是否过期及素材额度"
)

type ReviewService struct {
	reviews      AssetReviewRepository
	reviewReader ProjectAssetReviewReader
	assets       ReviewAssetStore
	references   AssetReferenceResolver
	projects     AssetProjectValidator
	gateway      ReviewGateway
	tasks        ReviewTaskStore
	transactions TransactionManager
	ids          IDGenerator
	clock        Clock
}

func NewReviewService(reviews AssetReviewRepository, assets ReviewAssetStore, references AssetReferenceResolver, projects AssetProjectValidator, gateway ReviewGateway, tasks ReviewTaskStore, transactions TransactionManager, ids IDGenerator, clock Clock) *ReviewService {
	service := &ReviewService{reviews: reviews, assets: assets, references: references, projects: projects, gateway: gateway, tasks: tasks, transactions: transactions, ids: ids, clock: clock}
	if reader, ok := reviews.(ProjectAssetReviewReader); ok {
		service.reviewReader = reader
	}
	return service
}

type BatchGetReviewsInput struct {
	ReviewScope
	ProjectID string
	AssetIDs  []string
}

type AssetReviews struct {
	AssetID string
	Reviews []domainasset.Review
}

func (s *ReviewService) BatchGetReviews(ctx context.Context, input BatchGetReviewsInput) ([]AssetReviews, error) {
	if !validReviewScope(input.ReviewScope) || strings.TrimSpace(input.ProjectID) == "" || len(input.AssetIDs) == 0 || len(input.AssetIDs) > 100 || s.reviewReader == nil {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	ids := make([]string, 0, len(input.AssetIDs))
	seen := make(map[string]struct{}, len(input.AssetIDs))
	for _, assetID := range input.AssetIDs {
		assetID = strings.TrimSpace(assetID)
		if assetID == "" {
			return nil, errno.New(errno.ErrInvalidArgument)
		}
		if _, exists := seen[assetID]; exists {
			continue
		}
		seen[assetID] = struct{}{}
		ids = append(ids, assetID)
	}
	reviews, err := s.reviewReader.BatchGetProjectAssetReviews(ctx, input.ReviewScope, input.ProjectID, ids)
	if err != nil {
		return nil, classifyReview(err)
	}
	result := make([]AssetReviews, 0, len(ids))
	for _, assetID := range ids {
		result = append(result, AssetReviews{AssetID: assetID, Reviews: reviews[assetID]})
	}
	return result, nil
}

type SubmitReviewInput struct {
	ReviewScope
	ProjectID, AssetID, PackageID string
	Upload                        *ReviewAssetUpload
}

type ReviewAssetUpload struct {
	ClientID, SourceAssetID, SourceRevisionID, FileName string
}

type SubmitReviewResult struct {
	AssetID string
	Review  domainasset.Review
}

type SubmitReviewItem struct {
	AssetID, PackageID string
	Upload             *ReviewAssetUpload
}

type BatchSubmitReviewInput struct {
	ReviewScope
	ProjectID string
	Items     []SubmitReviewItem
}

type BatchSubmitReviewResult struct {
	AssetID, PackageID      string
	Review                  *domainasset.Review
	ErrorCode, ErrorMessage string
}

func (s *ReviewService) ListPackages(ctx context.Context, scope ReviewScope) ([]BenefitPackage, error) {
	if !validReviewScope(scope) {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	items, err := s.gateway.ListBenefitPackages(ctx, scope.TenantID, *scope.WorkspaceID)
	if err != nil {
		return nil, classifyDependency(err)
	}
	return items, nil
}

func (s *ReviewService) BatchSubmit(ctx context.Context, input BatchSubmitReviewInput) ([]BatchSubmitReviewResult, error) {
	if !validReviewScope(input.ReviewScope) || strings.TrimSpace(input.ProjectID) == "" || len(input.Items) == 0 || len(input.Items) > 100 {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	results := make([]BatchSubmitReviewResult, len(input.Items))
	groups := make(map[string][]int, len(input.Items))
	for index, item := range input.Items {
		groups[reviewSubmissionKey(item)] = append(groups[reviewSubmissionKey(item)], index)
	}
	var wait sync.WaitGroup
	wait.Add(len(groups))
	for _, indices := range groups {
		go func() {
			defer wait.Done()
			for _, index := range indices {
				item := input.Items[index]
				result, err := s.Submit(ctx, SubmitReviewInput{ReviewScope: input.ReviewScope, ProjectID: input.ProjectID, AssetID: item.AssetID, PackageID: item.PackageID, Upload: item.Upload})
				batch := BatchSubmitReviewResult{AssetID: item.AssetID, PackageID: item.PackageID}
				if err != nil {
					batch.ErrorCode, batch.ErrorMessage = string(errno.CodeOf(err)), errno.MessageOf(err)
				} else {
					batch.AssetID, batch.Review = result.AssetID, &result.Review
				}
				results[index] = batch
			}
		}()
	}
	wait.Wait()
	return results, nil
}

func reviewSubmissionKey(item SubmitReviewItem) string {
	if item.Upload != nil {
		return item.PackageID + "\x00upload\x00" + item.Upload.ClientID
	}
	return item.PackageID + "\x00asset\x00" + item.AssetID
}

func (s *ReviewService) Submit(ctx context.Context, input SubmitReviewInput) (SubmitReviewResult, error) {
	if !validReviewInput(input) {
		return SubmitReviewResult{}, errno.New(errno.ErrInvalidArgument)
	}
	packages, err := s.gateway.ListBenefitPackages(ctx, input.TenantID, *input.WorkspaceID)
	if err != nil {
		return SubmitReviewResult{}, classifyDependency(err)
	}
	var selected *BenefitPackage
	for index := range packages {
		if packages[index].ID == input.PackageID {
			selected = &packages[index]
			break
		}
	}
	if selected == nil {
		return SubmitReviewResult{}, errno.New(errno.ErrFailedPrecondition)
	}
	assetItem, err := s.resolveReviewAsset(ctx, input)
	if err != nil {
		return SubmitReviewResult{}, err
	}
	if !s.reviewAssetBelongsToProject(ctx, input, assetItem) {
		return SubmitReviewResult{}, errno.New(errno.ErrFailedPrecondition)
	}
	reviewID, err := s.ids.NewID()
	if err != nil {
		return SubmitReviewResult{}, errno.Wrap(errno.ErrInternalError, err)
	}
	taskRunID, err := s.ids.NewID()
	if err != nil {
		return SubmitReviewResult{}, errno.Wrap(errno.ErrInternalError, err)
	}
	now := s.clock.Now()
	reserve := ReserveAssetReviewInput{
		ID: reviewID, TaskRunID: taskRunID, TenantID: input.TenantID, WorkspaceID: input.WorkspaceID, ProjectID: input.ProjectID,
		PackageID: selected.ID, PackageName: selected.Name, AssetID: assetItem.ID, ModelIDs: append([]string{}, selected.ModelIDs...),
		SystemPresetModels: selected.IsPreset, Now: now,
	}
	run := domaintask.TaskRun{ID: taskRunID, TenantID: input.TenantID, WorkspaceID: input.WorkspaceID, CreatedBy: input.CallerID, RunType: domaintask.RunTypeAssetReview, SubjectType: domaintask.SubjectTypeAsset, SubjectID: assetItem.ID, Status: domaintask.StatusQueued, StateVersion: 1, CreatedAt: now, UpdatedAt: now}
	run.IsInternal = true
	schedule := domaintask.PollSchedule{TaskRunID: taskRunID, NextPollAt: now, StateVersion: 1, DeadlineAt: now.Add(reviewDeadline), CreatedAt: now, UpdatedAt: now}
	err = s.transactions.WithinTransaction(ctx, func(tx context.Context) error {
		replacement, replaceErr := s.reviews.ReplaceAssetReview(tx, reserve)
		if replaceErr != nil {
			return replaceErr
		}
		if replaceErr = cancelReviewTasks(tx, replacement.Replaced, s.tasks, now); replaceErr != nil {
			return replaceErr
		}
		if replaceErr = s.tasks.Create(tx, run); replaceErr != nil {
			return replaceErr
		}
		return s.tasks.CreatePollSchedule(tx, schedule)
	})
	if err != nil {
		return SubmitReviewResult{}, classifyReview(err)
	}
	return SubmitReviewResult{AssetID: assetItem.ID, Review: domainasset.Review{PackageID: selected.ID, PackageName: selected.Name, ModelIDs: selected.ModelIDs, SystemPresetModels: selected.IsPreset, Status: domainasset.ReviewStatusSubmitting, CreatedAt: now, UpdatedAt: now}}, nil
}

func validReviewInput(input SubmitReviewInput) bool {
	if !validReviewScope(input.ReviewScope) || strings.TrimSpace(input.ProjectID) == "" || strings.TrimSpace(input.PackageID) == "" {
		return false
	}
	hasAssetID, hasUpload := strings.TrimSpace(input.AssetID) != "", input.Upload != nil
	if hasAssetID == hasUpload {
		return false
	}
	return !hasUpload || strings.TrimSpace(input.Upload.ClientID) != "" && strings.TrimSpace(input.Upload.SourceAssetID) != "" && strings.TrimSpace(input.Upload.SourceRevisionID) != "" && strings.TrimSpace(input.Upload.FileName) != ""
}

func (s *ReviewService) resolveReviewAsset(ctx context.Context, input SubmitReviewInput) (domainasset.Asset, error) {
	scope := applicationasset.Scope{TenantID: input.TenantID, WorkspaceID: input.WorkspaceID, CallerID: input.CallerID}
	if input.Upload != nil {
		item, _, err := s.assets.CreateIdempotent(ctx, applicationasset.CreateInput{Scope: scope, ProjectID: &input.ProjectID, OwnerType: domainasset.OwnerProject, OwnerID: input.ProjectID, SourceAssetID: input.Upload.SourceAssetID, SourceRevisionID: input.Upload.SourceRevisionID, FileName: input.Upload.FileName, CreationKey: reviewUploadCreationKey(input.ProjectID, input.Upload.ClientID)})
		return item, err
	}
	items, err := s.assets.BypassBatchGet(ctx, applicationasset.BypassBatchGetInput{Scope: scope, AssetIDs: []string{input.AssetID}})
	if err != nil {
		return domainasset.Asset{}, err
	}
	if len(items) != 1 || items[0].ID != input.AssetID {
		return domainasset.Asset{}, errno.New(errno.ErrFailedPrecondition)
	}
	return items[0], nil
}

func (s *ReviewService) reviewAssetBelongsToProject(ctx context.Context, input SubmitReviewInput, item domainasset.Asset) bool {
	switch item.OwnerType {
	case domainasset.OwnerProject:
		return item.OwnerID == input.ProjectID
	case domainasset.OwnerResource:
		return s.projects.ValidateReviewAsset(ctx, input.ReviewScope, input.ProjectID, item.OwnerID, item.ID) == nil
	default:
		return false
	}
}

func reviewUploadCreationKey(projectID, clientID string) string {
	sum := sha256.Sum256([]byte(projectID + "\x00" + clientID))
	return fmt.Sprintf("asset-review-upload:%x", sum)
}

func isAbsoluteHTTPURL(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	return err == nil && parsed.Host != "" && (parsed.Scheme == "http" || parsed.Scheme == "https")
}

func (s *ReviewService) RunType() domaintask.RunType { return domaintask.RunTypeAssetReview }

func (s *ReviewService) ProcessPollClaim(ctx context.Context, run domaintask.TaskRun, schedule domaintask.PollSchedule) error {
	if run.RunType != domaintask.RunTypeAssetReview || schedule.TaskRunID != run.ID {
		return errors.New("asset review poll claim does not match task run")
	}
	record, err := s.reviews.GetAssetReviewByTaskRun(ctx, run.ID)
	if err != nil {
		return err
	}
	if record.Status == domainasset.ReviewStatusSubmitting {
		return s.processSubmission(ctx, run, schedule, record)
	}
	if record.Status != domainasset.ReviewStatusProcessing {
		return fmt.Errorf("asset review %s has unsupported scheduled status %q", record.ID, record.Status)
	}
	if record.ReservationID != "" {
		if _, err = s.gateway.TransitionBenefitPackageReview(ctx, record.TenantID, workspaceID(record.WorkspaceID), record.PackageID, record.ReservationID, "committed"); err != nil {
			return err
		}
	}
	now := s.clock.Now()
	if !now.Before(schedule.DeadlineAt) {
		return s.finish(ctx, run, schedule, record, domainasset.ReviewStatusFailed, "审核状态查询超时")
	}
	result, err := s.gateway.GetReviewedAsset(ctx, record.TenantID, workspaceID(record.WorkspaceID), record.PackageID, record.ProviderAssetID)
	if err != nil {
		_, rescheduleErr := s.tasks.ReschedulePoll(ctx, schedule, domaintask.PollScheduleUpdate{NextPollAt: now.Add(reviewPollInterval), PollAttempts: schedule.PollAttempts + 1, ConsecutiveErrors: schedule.ConsecutiveErrors + 1}, now)
		return errors.Join(err, rescheduleErr)
	}
	switch result.Status {
	case ProviderAssetActive:
		return s.finish(ctx, run, schedule, record, domainasset.ReviewStatusApproved, "")
	case ProviderAssetFailed:
		reason := strings.TrimSpace(result.FailureReason)
		if reason == "" {
			reason = "素材未通过合规审核"
		}
		return s.finish(ctx, run, schedule, record, domainasset.ReviewStatusFailed, reason)
	default:
		_, err = s.tasks.ReschedulePoll(ctx, schedule, domaintask.PollScheduleUpdate{NextPollAt: now.Add(reviewPollInterval), PollAttempts: schedule.PollAttempts + 1}, now)
		return err
	}
}

func (s *ReviewService) processSubmission(ctx context.Context, run domaintask.TaskRun, schedule domaintask.PollSchedule, record AssetReviewRecord) error {
	now := s.clock.Now()
	if record.SubmissionStartedAt != nil {
		return s.finishSubmissionFailure(ctx, run, schedule, record, "素材提交结果不确定，请重新送审")
	}
	if !now.Before(record.CreatedAt.Add(reviewSubmissionDeadline)) {
		return s.finishSubmissionFailure(ctx, run, schedule, record, "素材提交审核超时")
	}
	if record.ReservationID == "" {
		reservation, err := s.gateway.ReserveBenefitPackageReview(ctx, record.TenantID, workspaceID(record.WorkspaceID), record.PackageID, record.ID, record.ProjectID, record.AssetID)
		if err != nil {
			return s.rescheduleSubmission(ctx, schedule)
		}
		if err = s.reviews.SetAssetReviewReservation(ctx, record.ID, reservation.ID, now); err != nil {
			return err
		}
		record.ReservationID = reservation.ID
	}
	assets, err := s.assets.BypassBatchGet(ctx, applicationasset.BypassBatchGetInput{Scope: applicationasset.Scope{TenantID: record.TenantID, WorkspaceID: record.WorkspaceID, CallerID: run.CreatedBy}, AssetIDs: []string{record.AssetID}})
	if err != nil {
		return s.rescheduleSubmission(ctx, schedule)
	}
	if len(assets) != 1 || assets[0].ID != record.AssetID {
		return s.finishSubmissionFailure(ctx, run, schedule, record, "送审素材不存在")
	}
	referenceURL, err := s.references.PublicReferenceURL(ctx, record.TenantID, run.CreatedBy, assets[0])
	if err != nil {
		return s.rescheduleSubmission(ctx, schedule)
	}
	if !isAbsoluteHTTPURL(referenceURL) {
		return s.finishSubmissionFailure(ctx, run, schedule, record, "送审素材地址不可用")
	}
	if err = s.reviews.MarkAssetReviewSubmissionStarted(ctx, record.ID, run.ID, now); err != nil {
		return err
	}
	providerAsset, err := s.gateway.SubmitReviewedAsset(ctx, record.TenantID, workspaceID(record.WorkspaceID), record.PackageID, referenceURL, providerAssetType(assets[0].MediaType), assets[0].FileName)
	if errors.Is(err, ErrAssetReviewQuotaExceeded) {
		s.logProviderSubmissionFailure(ctx, "Ark asset submission quota exhausted", record, err)
		return s.finishSubmissionFailure(ctx, run, schedule, record, assetReviewSharedPoolQuotaReason)
	}
	if errors.Is(err, ErrAssetReviewRateLimited) {
		return s.retrySubmission(ctx, schedule, record, assetReviewRateLimitWaitingReason, err)
	}
	if err != nil {
		return s.retrySubmission(ctx, schedule, record, "", nil)
	}
	submittedAt := s.clock.Now()
	err = s.transactions.WithinTransaction(ctx, func(tx context.Context) error {
		if updateErr := s.reviews.MarkAssetReviewProcessing(tx, record.ID, run.ID, providerAsset.ID, submittedAt); updateErr != nil {
			return updateErr
		}
		won, updateErr := s.tasks.UpdateTaskRun(tx, run, applicationtask.TaskRunUpdate{Status: domaintask.StatusRunning, StartedAt: &submittedAt}, submittedAt)
		if updateErr != nil || !won {
			return errors.Join(updateErr, errors.New("asset review task run lost its submission fence"))
		}
		rescheduled, updateErr := s.tasks.ReschedulePoll(tx, schedule, domaintask.PollScheduleUpdate{NextPollAt: submittedAt.Add(reviewPollInterval), PollAttempts: schedule.PollAttempts + 1}, submittedAt)
		if updateErr != nil || !rescheduled {
			return errors.Join(updateErr, errors.New("asset review poll schedule lost its submission fence"))
		}
		return nil
	})
	if err != nil {
		return err
	}
	_, err = s.gateway.TransitionBenefitPackageReview(ctx, record.TenantID, workspaceID(record.WorkspaceID), record.PackageID, record.ReservationID, "committed")
	return err
}

func (s *ReviewService) retrySubmission(ctx context.Context, schedule domaintask.PollSchedule, record AssetReviewRecord, reason string, providerErr error) error {
	now := s.clock.Now()
	attempt := schedule.ConsecutiveErrors + 1
	delay := reviewSubmissionNominalDelay(attempt)
	if providerErr != nil {
		delay = reviewSubmissionRetryDelay(attempt, rand.Float64())
	}
	err := s.transactions.WithinTransaction(ctx, func(tx context.Context) error {
		if err := s.reviews.ResetAssetReviewSubmission(tx, record.ID, schedule.TaskRunID, reason, now); err != nil {
			return err
		}
		rescheduled, err := s.tasks.ReschedulePoll(tx, schedule, domaintask.PollScheduleUpdate{NextPollAt: now.Add(delay), PollAttempts: schedule.PollAttempts + 1, ConsecutiveErrors: attempt}, now)
		if err != nil || !rescheduled {
			return errors.Join(err, errors.New("asset review poll schedule lost its retry fence"))
		}
		return nil
	})
	if err == nil && providerErr != nil {
		s.logProviderSubmissionFailure(ctx, "Ark asset submission rate limited; waiting to retry", record, providerErr, "attempt", attempt, "next_retry_at", now.Add(delay))
	}
	return err
}

func (s *ReviewService) rescheduleSubmission(ctx context.Context, schedule domaintask.PollSchedule) error {
	now := s.clock.Now()
	rescheduled, err := s.tasks.ReschedulePoll(ctx, schedule, domaintask.PollScheduleUpdate{NextPollAt: now.Add(reviewSubmissionNominalDelay(schedule.ConsecutiveErrors + 1)), PollAttempts: schedule.PollAttempts + 1, ConsecutiveErrors: schedule.ConsecutiveErrors + 1}, now)
	if err != nil || !rescheduled {
		return errors.Join(err, errors.New("asset review poll schedule lost its retry fence"))
	}
	return nil
}

func reviewSubmissionRetryDelay(attempt int32, jitterUnit float64) time.Duration {
	delay := reviewSubmissionNominalDelay(attempt)
	if jitterUnit < 0 {
		jitterUnit = 0
	} else if jitterUnit > 1 {
		jitterUnit = 1
	}
	jittered := time.Duration(float64(delay) * (1 + 0.2*jitterUnit))
	if jittered > reviewSubmissionMaxDelay {
		return reviewSubmissionMaxDelay
	}
	return jittered
}

func reviewSubmissionNominalDelay(attempt int32) time.Duration {
	delay := reviewSubmissionBackoff
	for current := int32(1); current < attempt && delay < reviewSubmissionMaxDelay; current++ {
		delay *= 2
	}
	if delay > reviewSubmissionMaxDelay {
		return reviewSubmissionMaxDelay
	}
	return delay
}

func (s *ReviewService) logProviderSubmissionFailure(ctx context.Context, message string, record AssetReviewRecord, err error, extra ...any) {
	fields := []any{"tenant_id", record.TenantID, "review_id", record.ID, "package_id", record.PackageID, "task_run_id", record.TaskRunID}
	var providerError *AssetReviewProviderError
	if errors.As(err, &providerError) {
		fields = append(fields, "provider_code", providerError.Code, "provider_request_id", providerError.RequestID)
	}
	fields = append(fields, extra...)
	slog.WarnContext(ctx, message, fields...)
}

func (s *ReviewService) finishSubmissionFailure(ctx context.Context, run domaintask.TaskRun, schedule domaintask.PollSchedule, record AssetReviewRecord, reason string) error {
	if record.ReservationID != "" {
		if _, err := s.gateway.TransitionBenefitPackageReview(ctx, record.TenantID, workspaceID(record.WorkspaceID), record.PackageID, record.ReservationID, "released"); err != nil {
			return err
		}
	}
	now := s.clock.Now()
	return s.transactions.WithinTransaction(ctx, func(tx context.Context) error {
		if err := s.reviews.MarkAssetReviewFailed(tx, record.ID, reason, now); err != nil {
			return err
		}
		won, err := s.tasks.UpdateTaskRun(tx, run, applicationtask.TaskRunUpdate{Status: domaintask.StatusFailed, ErrorCode: "ASSET_REVIEW_SUBMISSION_FAILED", ErrorMessage: reason, StartedAt: run.StartedAt, FinishedAt: &now}, now)
		if err != nil || !won {
			return errors.Join(err, errors.New("asset review task run lost its failure fence"))
		}
		completed, err := s.tasks.CompletePollSchedule(tx, schedule)
		if err != nil || !completed {
			return errors.Join(err, errors.New("asset review poll schedule lost its failure fence"))
		}
		return nil
	})
}

func (s *ReviewService) finish(ctx context.Context, run domaintask.TaskRun, schedule domaintask.PollSchedule, record AssetReviewRecord, status domainasset.ReviewStatus, reason string) error {
	now := s.clock.Now()
	return s.transactions.WithinTransaction(ctx, func(tx context.Context) error {
		if err := s.reviews.MarkAssetReviewTerminal(tx, record.ID, status, reason, now); err != nil {
			return err
		}
		taskStatus, code := domaintask.Status(domaintask.StatusSucceeded), ""
		if status == domainasset.ReviewStatusFailed {
			taskStatus, code = domaintask.StatusFailed, "ASSET_REVIEW_FAILED"
		}
		won, err := s.tasks.UpdateTaskRun(tx, run, applicationtask.TaskRunUpdate{Status: taskStatus, ErrorCode: code, ErrorMessage: reason, StartedAt: run.StartedAt, FinishedAt: &now}, now)
		if err != nil || !won {
			return errors.Join(err, errors.New("asset review task run lost its update fence"))
		}
		completed, err := s.tasks.CompletePollSchedule(tx, schedule)
		if err != nil || !completed {
			return errors.Join(err, errors.New("asset review poll schedule lost its update fence"))
		}
		return nil
	})
}

func validReviewScope(scope ReviewScope) bool {
	return strings.TrimSpace(scope.TenantID) != "" && scope.WorkspaceID != nil && strings.TrimSpace(*scope.WorkspaceID) != "" && strings.TrimSpace(scope.CallerID) != ""
}

func workspaceID(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func providerAssetType(mediaType domainasset.MediaType) string {
	switch mediaType {
	case domainasset.MediaImage:
		return "Image"
	case domainasset.MediaVideo:
		return "Video"
	case domainasset.MediaAudio:
		return "Audio"
	default:
		return ""
	}
}

func classifyDependency(err error) error { return errno.Wrap(errno.ErrExternalDependencyError, err) }

func classifyReview(err error) error {
	if errors.Is(err, ErrReviewStateConflict) {
		return errno.Wrap(errno.ErrConflict, err)
	}
	return errno.Wrap(errno.ErrPersistenceError, err)
}
