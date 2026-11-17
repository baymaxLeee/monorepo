package application

import (
	"context"
	"errors"
	"testing"

	"github.com/example/monorepo/admin/internal/domain"
)

var errBenefitNotFound = errors.New("not found")

type benefitErrorClassifier struct{}

func (benefitErrorClassifier) IsNotFound(err error) bool { return errors.Is(err, errBenefitNotFound) }

type benefitRepositoryStub struct {
	BenefitPackageRepository
	packageValue domain.BenefitPackage
	usage        map[string][2]int64
	reservation  domain.ReviewReservation
	cleanups     map[string]domain.ReviewCleanup
	created      *domain.ReviewReservation
}

func (r *benefitRepositoryStub) Transaction(ctx context.Context, fn func(BenefitPackageRepository) error) error {
	return fn(r)
}

func (r *benefitRepositoryStub) GetBenefitPackage(context.Context, string, string, string, bool) (domain.BenefitPackage, error) {
	return r.packageValue, nil
}

func (r *benefitRepositoryStub) ReviewUsage(context.Context, string, string) (map[string][2]int64, error) {
	return r.usage, nil
}

func (r *benefitRepositoryStub) GetReviewReservationByOperation(context.Context, string, bool) (domain.ReviewReservation, error) {
	return domain.ReviewReservation{}, errBenefitNotFound
}

func (r *benefitRepositoryStub) GetActiveReviewReservation(context.Context, string, string, string, bool) (domain.ReviewReservation, error) {
	return domain.ReviewReservation{}, errBenefitNotFound
}

func (r *benefitRepositoryStub) CreateReviewReservation(_ context.Context, value domain.ReviewReservation) error {
	r.created = &value
	return nil
}

func (r *benefitRepositoryStub) GetReviewReservation(context.Context, string, bool) (domain.ReviewReservation, error) {
	return r.reservation, nil
}

func (r *benefitRepositoryStub) SaveReviewReservation(_ context.Context, value domain.ReviewReservation) error {
	r.reservation = value
	return nil
}

func (r *benefitRepositoryStub) GetReviewCleanup(_ context.Context, id string, _ bool) (domain.ReviewCleanup, error) {
	value, ok := r.cleanups[id]
	if !ok {
		return domain.ReviewCleanup{}, errBenefitNotFound
	}
	return value, nil
}

func (r *benefitRepositoryStub) CreateReviewCleanup(_ context.Context, value domain.ReviewCleanup) error {
	r.cleanups[value.CleanupID] = value
	return nil
}

func (r *benefitRepositoryStub) SaveReviewCleanup(_ context.Context, value domain.ReviewCleanup) error {
	r.cleanups[value.CleanupID] = value
	return nil
}

func (r *benefitRepositoryStub) CountPendingReviewCleanups(context.Context, string) (int64, error) {
	var count int64
	for _, value := range r.cleanups {
		if value.Status == "pending" {
			count++
		}
	}
	return count, nil
}

func TestReserveBenefitPackageEnforcesCombinedQuota(t *testing.T) {
	limit := int64(2)
	repository := &benefitRepositoryStub{
		packageValue: domain.BenefitPackage{ID: "package", TenantID: "tenant", WorkspaceID: "workspace", Enabled: true, MaterialLimit: &limit},
		usage:        map[string][2]int64{"package": {1, 1}},
		cleanups:     map[string]domain.ReviewCleanup{},
	}
	service := BenefitPackageService{Repository: repository, Errors: benefitErrorClassifier{}}
	_, err := service.Reserve(context.Background(), "workspace", "tenant", "package", "reservation", "project", "asset")
	var appErr *Error
	if !errors.As(err, &appErr) || appErr.Status != 409 {
		t.Fatalf("expected quota conflict, got %v", err)
	}
	if repository.created != nil {
		t.Fatal("quota failure must not create a reservation")
	}
}

func TestNormalizeBenefitPackageModelsPreservesFirstSeenOrder(t *testing.T) {
	models := normalizeIDs([]string{" model-b ", "model-a", "model-b", ""})
	if len(models) != 2 || models[0] != "model-b" || models[1] != "model-a" {
		t.Fatalf("unexpected normalized models: %v", models)
	}
}

func TestReviewCleanupReleasesReservationAfterLastClaim(t *testing.T) {
	repository := &benefitRepositoryStub{
		reservation: domain.ReviewReservation{ID: "reservation", TenantID: "tenant", WorkspaceID: "workspace", BenefitPackageID: "package", Status: "committed"},
		cleanups:    map[string]domain.ReviewCleanup{},
	}
	service := BenefitPackageService{Repository: repository, Errors: benefitErrorClassifier{}}
	claim, err := service.BeginCleanup(context.Background(), "workspace", "tenant", "package", "reservation", "cleanup")
	if err != nil {
		t.Fatal(err)
	}
	if claim.Status != "pending" || repository.reservation.Status != "releasing" {
		t.Fatalf("unexpected begin-cleanup state: claim=%s reservation=%s", claim.Status, repository.reservation.Status)
	}
	claim, err = service.CompleteCleanup(context.Background(), "workspace", "tenant", "package", "reservation", "cleanup")
	if err != nil {
		t.Fatal(err)
	}
	if claim.Status != "completed" || claim.CompletedAt == nil || repository.reservation.Status != "released" {
		t.Fatalf("unexpected completed state: claim=%+v reservation=%s", claim, repository.reservation.Status)
	}
}

func TestTransitionHidesCrossScopeReservation(t *testing.T) {
	repository := &benefitRepositoryStub{
		reservation: domain.ReviewReservation{ID: "reservation", TenantID: "other", WorkspaceID: "workspace", BenefitPackageID: "package", Status: "reserved"},
		cleanups:    map[string]domain.ReviewCleanup{},
	}
	service := BenefitPackageService{Repository: repository, Errors: benefitErrorClassifier{}}
	_, err := service.Transition(context.Background(), "workspace", "tenant", "package", "reservation", "committed")
	var appErr *Error
	if !errors.As(err, &appErr) || appErr.Status != 404 {
		t.Fatalf("expected cross-scope reservation to be hidden, got %v", err)
	}
	if repository.reservation.Status != "reserved" {
		t.Fatalf("cross-scope request changed reservation to %s", repository.reservation.Status)
	}
}
