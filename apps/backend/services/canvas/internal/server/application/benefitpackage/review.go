package benefitpackage

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	applicationasset "github.com/example/monorepo/canvas/internal/server/application/asset"
	applicationquota "github.com/example/monorepo/canvas/internal/server/application/quota"
	applicationtask "github.com/example/monorepo/canvas/internal/server/application/task"
	domainasset "github.com/example/monorepo/canvas/internal/server/domain/asset"
	domaintask "github.com/example/monorepo/canvas/internal/server/domain/task"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

const (
	reviewPollInterval       = 3 * time.Second
	reviewDeadline           = 24 * time.Hour
	reviewSubmissionDeadline = 10 * time.Minute
	reviewSubmissionBackoff  = 5 * time.Second
	reviewSubmissionMaxDelay = time.Minute
)

type ReviewService struct {
	packages     Repository
	reviews      AssetReviewRepository
	reviewReader ProjectAssetReviewReader
	assets       ReviewAssetStore
	references   AssetReferenceResolver
	projects     AssetProjectValidator
	provider     AssetReviewGateway
	cipher       CredentialCipher
	tasks        ReviewTaskStore
	transactions TransactionManager
	ids          IDGenerator
	clock        Clock
	quota        ReviewQuota
}

type ReviewOption func(*ReviewService)

func WithReviewQuota(quota ReviewQuota) ReviewOption {
	return func(service *ReviewService) { service.quota = quota }
}

func NewReviewService(packages Repository, reviews AssetReviewRepository, assets ReviewAssetStore, references AssetReferenceResolver, projects AssetProjectValidator, provider AssetReviewGateway, cipher CredentialCipher, tasks ReviewTaskStore, transactions TransactionManager, ids IDGenerator, clock Clock, options ...ReviewOption) *ReviewService {
	service := &ReviewService{packages: packages, reviews: reviews, assets: assets, references: references, projects: projects, provider: provider, cipher: cipher, tasks: tasks, transactions: transactions, ids: ids, clock: clock}
	if reviewReader, ok := reviews.(ProjectAssetReviewReader); ok {
		service.reviewReader = reviewReader
	}
	for _, option := range options {
		option(service)
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
	ClientID, BlobID, FileName string
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

func (s *ReviewService) BatchSubmit(ctx context.Context, input BatchSubmitReviewInput) ([]BatchSubmitReviewResult, error) {
	if !validReviewScope(input.ReviewScope) || strings.TrimSpace(input.ProjectID) == "" || len(input.Items) == 0 || len(input.Items) > 100 {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	results := make([]BatchSubmitReviewResult, len(input.Items))
	groups := make(map[string][]int, len(input.Items))
	for index, item := range input.Items {
		key := reviewSubmissionKey(item)
		groups[key] = append(groups[key], index)
	}
	var wait sync.WaitGroup
	wait.Add(len(groups))
	for _, indices := range groups {
		go func() {
			defer wait.Done()
			// Local admission for distinct targets can proceed independently. Keep
			// replacements of the same current review ordered so one request cannot
			// race its own durable SUBMITTING record.
			for _, index := range indices {
				item := input.Items[index]
				result, err := s.Submit(ctx, SubmitReviewInput{
					ReviewScope: input.ReviewScope, ProjectID: input.ProjectID,
					AssetID: item.AssetID, PackageID: item.PackageID, Upload: item.Upload,
				})
				batchResult := BatchSubmitReviewResult{AssetID: item.AssetID, PackageID: item.PackageID}
				if err != nil {
					batchResult.ErrorCode = string(errno.CodeOf(err))
					batchResult.ErrorMessage = errno.MessageOf(err)
				} else {
					batchResult.AssetID = result.AssetID
					batchResult.Review = &result.Review
				}
				results[index] = batchResult
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
	item, err := s.packages.Get(ctx, Scope{TenantID: input.TenantID, CallerID: input.CallerID}, input.PackageID)
	if err != nil {
		return SubmitReviewResult{}, classify(err)
	}
	if !item.Enabled || item.AssetGroupID == "" {
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
	reserveInput := ReserveAssetReviewInput{
		ID: reviewID, TaskRunID: taskRunID, TenantID: input.TenantID, WorkspaceID: input.WorkspaceID,
		ProjectID: input.ProjectID, PackageID: item.ID, PackageName: item.Name, AssetID: assetItem.ID,
		ScopeType: item.ScopeType, Now: now,
	}
	run := domaintask.TaskRun{ID: taskRunID, TenantID: input.TenantID, WorkspaceID: input.WorkspaceID, CreatedBy: input.CallerID, RunType: domaintask.RunTypeAssetReview, SubjectType: domaintask.SubjectTypeAsset, SubjectID: assetItem.ID, Status: domaintask.StatusQueued, StateVersion: 1, CreatedAt: now, UpdatedAt: now}
	run.IsInternal = true
	schedule := domaintask.PollSchedule{TaskRunID: taskRunID, NextPollAt: now, StateVersion: 1, DeadlineAt: now.Add(reviewDeadline), CreatedAt: now, UpdatedAt: now}
	var quotaReservation applicationquota.Reservation
	var replacement ReplaceAssetReviewResult
	err = s.transactions.WithinTransaction(ctx, func(tx context.Context) error {
		var replaceErr error
		replacement, replaceErr = s.reviews.ReplaceAssetReview(tx, reserveInput)
		if replaceErr != nil {
			return replaceErr
		}
		if replaceErr = cancelReviewTasks(tx, replacement.Replaced, s.tasks, s.quota, now); replaceErr != nil {
			return replaceErr
		}
		if item.IsPreset && s.quota != nil {
			quotaReservation, replaceErr = s.quota.ReservePresetEntitlement(
				tx, input.TenantID, reviewID, item.ID, assetItem.ID,
			)
			if replaceErr != nil {
				return replaceErr
			}
			if replaceErr = s.reviews.SetAssetReviewQuotaReservation(tx, reviewID, quotaReservation.ID, now); replaceErr != nil {
				return replaceErr
			}
		}
		if replaceErr = s.tasks.Create(tx, run); replaceErr != nil {
			return replaceErr
		}
		return s.tasks.CreatePollSchedule(tx, schedule)
	})
	if err != nil {
		if errors.Is(err, applicationquota.ErrExceeded) || errors.Is(err, applicationquota.ErrUnavailable) || errors.Is(err, applicationquota.ErrReservationInProgress) {
			return SubmitReviewResult{}, classifyQuota(err, errno.ErrPresetEntitlementAssetQuotaExceeded)
		}
		return SubmitReviewResult{}, classifyReview(err)
	}
	return SubmitReviewResult{AssetID: assetItem.ID, Review: domainasset.Review{PackageID: item.ID, PackageName: item.Name, Status: domainasset.ReviewStatusSubmitting, CreatedAt: now, UpdatedAt: now}}, nil
}

func classifyQuota(err error, exceeded errno.ErrorCode) error {
	switch {
	case errors.Is(err, applicationquota.ErrExceeded):
		return errno.Wrap(exceeded, err)
	case errors.Is(err, applicationquota.ErrUnavailable):
		return errno.Wrap(errno.ErrQuotaUnavailable, err)
	case errors.Is(err, applicationquota.ErrReservationInProgress):
		return errno.Wrap(errno.ErrConflict, err)
	default:
		return errno.Wrap(errno.ErrPersistenceError, err)
	}
}

func validReviewInput(input SubmitReviewInput) bool {
	if !validReviewScope(input.ReviewScope) || strings.TrimSpace(input.ProjectID) == "" || strings.TrimSpace(input.PackageID) == "" {
		return false
	}
	hasAssetID := strings.TrimSpace(input.AssetID) != ""
	hasUpload := input.Upload != nil
	if hasAssetID == hasUpload {
		return false
	}
	return !hasUpload || strings.TrimSpace(input.Upload.ClientID) != "" && strings.TrimSpace(input.Upload.BlobID) != "" && strings.TrimSpace(input.Upload.FileName) != ""
}

func (s *ReviewService) resolveReviewAsset(ctx context.Context, input SubmitReviewInput) (domainasset.Asset, error) {
	scope := applicationasset.Scope{TenantID: input.TenantID, WorkspaceID: input.WorkspaceID, CallerID: input.CallerID}
	if input.Upload != nil {
		item, _, err := s.assets.CreateIdempotent(ctx, applicationasset.CreateInput{
			Scope: scope, ProjectID: &input.ProjectID, OwnerType: domainasset.OwnerProject, OwnerID: input.ProjectID,
			BlobID: input.Upload.BlobID, FileName: input.Upload.FileName,
			CreationKey: reviewUploadCreationKey(input.ProjectID, input.Upload.ClientID),
		})
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
	item, err := s.packages.Get(ctx, Scope{TenantID: record.TenantID}, record.PackageID)
	if errors.Is(err, ErrNotFound) {
		return s.finish(ctx, run, schedule, record.ID, domainasset.ReviewStatusFailed, "权益包不存在")
	}
	if err != nil {
		return err
	}
	accessKeyID, secretAccessKey, err := s.decryptCredentials(item.TenantID, item.EncryptedAccessKeyID, item.EncryptedSecretAccessKey)
	if err != nil {
		return s.finish(ctx, run, schedule, record.ID, domainasset.ReviewStatusFailed, "权益包凭证不可用")
	}
	now := s.clock.Now()
	if !now.Before(schedule.DeadlineAt) {
		return s.finish(ctx, run, schedule, record.ID, domainasset.ReviewStatusFailed, "审核状态查询超时")
	}
	result, err := s.provider.GetAsset(ctx, GetReviewedAssetInput{ProviderAssetID: record.ProviderAssetID, ProjectName: item.ProjectName, AccessKeyID: accessKeyID, SecretAccessKey: secretAccessKey})
	if err != nil {
		_, rescheduleErr := s.tasks.ReschedulePoll(ctx, schedule, domaintask.PollScheduleUpdate{NextPollAt: now.Add(reviewPollInterval), PollAttempts: schedule.PollAttempts + 1, ConsecutiveErrors: schedule.ConsecutiveErrors + 1}, now)
		return errors.Join(err, rescheduleErr)
	}
	switch result.Status {
	case ProviderAssetActive:
		return s.finish(ctx, run, schedule, record.ID, domainasset.ReviewStatusApproved, "")
	case ProviderAssetFailed:
		reason := strings.TrimSpace(result.FailureReason)
		if reason == "" {
			reason = "素材未通过合规审核"
		}
		return s.finish(ctx, run, schedule, record.ID, domainasset.ReviewStatusFailed, reason)
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
	item, err := s.packages.Get(ctx, Scope{TenantID: record.TenantID}, record.PackageID)
	if errors.Is(err, ErrNotFound) {
		return s.finishSubmissionFailure(ctx, run, schedule, record, "权益包不存在")
	}
	if err != nil {
		return s.rescheduleSubmission(ctx, schedule)
	}
	if !item.Enabled || strings.TrimSpace(item.AssetGroupID) == "" {
		return s.finishSubmissionFailure(ctx, run, schedule, record, "权益包不可用")
	}
	assets, err := s.assets.BypassBatchGet(ctx, applicationasset.BypassBatchGetInput{
		Scope:    applicationasset.Scope{TenantID: record.TenantID, WorkspaceID: record.WorkspaceID, CallerID: run.CreatedBy},
		AssetIDs: []string{record.AssetID},
	})
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
	accessKeyID, secretAccessKey, err := s.decryptCredentials(item.TenantID, item.EncryptedAccessKeyID, item.EncryptedSecretAccessKey)
	if err != nil {
		return s.finishSubmissionFailure(ctx, run, schedule, record, "权益包凭证不可用")
	}
	if err = s.reviews.MarkAssetReviewSubmissionStarted(ctx, record.ID, run.ID, now); err != nil {
		return err
	}
	providerAssetID, err := s.provider.CreateAsset(ctx, CreateReviewedAssetInput{
		AssetGroupID: item.AssetGroupID, URL: referenceURL, AssetType: providerAssetType(assets[0].MediaType),
		Name: assets[0].FileName, ProjectName: item.ProjectName,
		AccessKeyID: accessKeyID, SecretAccessKey: secretAccessKey,
	})
	if errors.Is(err, ErrAssetReviewRateLimited) {
		return s.retryRateLimitedSubmission(ctx, schedule, record)
	}
	if err != nil {
		return s.finishSubmissionFailure(ctx, run, schedule, record, "素材提交审核失败")
	}
	submittedAt := s.clock.Now()
	return s.transactions.WithinTransaction(ctx, func(tx context.Context) error {
		if updateErr := s.reviews.MarkAssetReviewProcessing(tx, record.ID, run.ID, providerAssetID, submittedAt); updateErr != nil {
			return updateErr
		}
		won, updateErr := s.tasks.UpdateTaskRun(tx, run, applicationtask.TaskRunUpdate{
			Status: domaintask.StatusRunning, StartedAt: &submittedAt,
		}, submittedAt)
		if updateErr != nil {
			return updateErr
		}
		if !won {
			return errors.New("asset review task run lost its submission fence")
		}
		rescheduled, updateErr := s.tasks.ReschedulePoll(tx, schedule, domaintask.PollScheduleUpdate{
			NextPollAt: submittedAt.Add(reviewPollInterval), PollAttempts: schedule.PollAttempts + 1,
		}, submittedAt)
		if updateErr != nil {
			return updateErr
		}
		if !rescheduled {
			return errors.New("asset review poll schedule lost its submission fence")
		}
		if record.QuotaReservationID != "" && s.quota != nil {
			return s.quota.CommitReservation(tx, applicationquota.Reservation{ID: record.QuotaReservationID})
		}
		return nil
	})
}

func (s *ReviewService) retryRateLimitedSubmission(ctx context.Context, schedule domaintask.PollSchedule, record AssetReviewRecord) error {
	now := s.clock.Now()
	return s.transactions.WithinTransaction(ctx, func(tx context.Context) error {
		if err := s.reviews.ResetAssetReviewSubmission(tx, record.ID, schedule.TaskRunID, now); err != nil {
			return err
		}
		rescheduled, err := s.tasks.ReschedulePoll(tx, schedule, domaintask.PollScheduleUpdate{
			NextPollAt:   now.Add(reviewSubmissionRetryDelay(schedule.ConsecutiveErrors + 1)),
			PollAttempts: schedule.PollAttempts + 1, ConsecutiveErrors: schedule.ConsecutiveErrors + 1,
		}, now)
		if err != nil {
			return err
		}
		if !rescheduled {
			return errors.New("asset review poll schedule lost its rate-limit retry fence")
		}
		return nil
	})
}

func (s *ReviewService) rescheduleSubmission(ctx context.Context, schedule domaintask.PollSchedule) error {
	now := s.clock.Now()
	rescheduled, err := s.tasks.ReschedulePoll(ctx, schedule, domaintask.PollScheduleUpdate{
		NextPollAt:   now.Add(reviewSubmissionRetryDelay(schedule.ConsecutiveErrors + 1)),
		PollAttempts: schedule.PollAttempts + 1, ConsecutiveErrors: schedule.ConsecutiveErrors + 1,
	}, now)
	if err != nil {
		return err
	}
	if !rescheduled {
		return errors.New("asset review poll schedule lost its submission retry fence")
	}
	return nil
}

func reviewSubmissionRetryDelay(attempt int32) time.Duration {
	delay := reviewSubmissionBackoff
	for current := int32(1); current < attempt && delay < reviewSubmissionMaxDelay; current++ {
		delay *= 2
	}
	if delay > reviewSubmissionMaxDelay {
		return reviewSubmissionMaxDelay
	}
	return delay
}

func (s *ReviewService) finishSubmissionFailure(ctx context.Context, run domaintask.TaskRun, schedule domaintask.PollSchedule, record AssetReviewRecord, reason string) error {
	now := s.clock.Now()
	return s.transactions.WithinTransaction(ctx, func(tx context.Context) error {
		if err := s.reviews.MarkAssetReviewFailed(tx, record.ID, reason, now); err != nil {
			return err
		}
		won, err := s.tasks.UpdateTaskRun(tx, run, applicationtask.TaskRunUpdate{
			Status: domaintask.StatusFailed, ErrorCode: "ASSET_REVIEW_SUBMISSION_FAILED",
			ErrorMessage: reason, StartedAt: run.StartedAt, FinishedAt: &now,
		}, now)
		if err != nil {
			return err
		}
		if !won {
			return errors.New("asset review task run lost its submission failure fence")
		}
		completed, err := s.tasks.CompletePollSchedule(tx, schedule)
		if err != nil {
			return err
		}
		if !completed {
			return errors.New("asset review poll schedule lost its submission failure fence")
		}
		if record.QuotaReservationID != "" && s.quota != nil {
			return s.quota.ReleaseReservation(tx, applicationquota.Reservation{ID: record.QuotaReservationID})
		}
		return nil
	})
}

func (s *ReviewService) finish(ctx context.Context, run domaintask.TaskRun, schedule domaintask.PollSchedule, reviewID string, status domainasset.ReviewStatus, reason string) error {
	now := s.clock.Now()
	return s.transactions.WithinTransaction(ctx, func(tx context.Context) error {
		if err := s.reviews.MarkAssetReviewTerminal(tx, reviewID, status, reason, now); err != nil {
			return err
		}
		taskStatus := domaintask.Status(domaintask.StatusSucceeded)
		code := ""
		if status == domainasset.ReviewStatusFailed {
			taskStatus, code = domaintask.StatusFailed, "ASSET_REVIEW_FAILED"
		}
		won, err := s.tasks.UpdateTaskRun(tx, run, applicationtask.TaskRunUpdate{Status: taskStatus, ErrorCode: code, ErrorMessage: reason, StartedAt: run.StartedAt, FinishedAt: &now}, now)
		if err != nil {
			return err
		}
		if !won {
			return errors.New("asset review task run lost its update fence")
		}
		completed, err := s.tasks.CompletePollSchedule(tx, schedule)
		if err != nil {
			return err
		}
		if !completed {
			return errors.New("asset review poll schedule lost its update fence")
		}
		return nil
	})
}

func (s *ReviewService) decryptCredentials(tenantID, encryptedAccessKeyID, encryptedSecret string) (string, string, error) {
	accessKeyID, err := s.cipher.Decrypt(tenantID, encryptedAccessKeyID)
	if err != nil {
		return "", "", err
	}
	secret, err := s.cipher.Decrypt(tenantID, encryptedSecret)
	return accessKeyID, secret, err
}

func validReviewScope(scope ReviewScope) bool {
	return strings.TrimSpace(scope.TenantID) != "" && strings.TrimSpace(scope.CallerID) != ""
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

func classifyReview(err error) error {
	if errors.Is(err, ErrReviewStateConflict) {
		return errno.Wrap(errno.ErrConflict, err)
	}
	return errno.Wrap(errno.ErrPersistenceError, err)
}
