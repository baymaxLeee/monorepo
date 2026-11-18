//go:build integration

package resource_test

import (
	"context"
	"errors"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	assetapp "github.com/example/monorepo/canvas/internal/application/asset"
	reviewapp "github.com/example/monorepo/canvas/internal/application/benefitpackage"
	projectapp "github.com/example/monorepo/canvas/internal/application/project"
	resourceapp "github.com/example/monorepo/canvas/internal/application/resource"
	assetdomain "github.com/example/monorepo/canvas/internal/domain/asset"
	projectdomain "github.com/example/monorepo/canvas/internal/domain/project"
	resourcedomain "github.com/example/monorepo/canvas/internal/domain/resource"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/asset"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/benefitpackage"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/project"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/resource"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

// Resource submission crosses the project, asset-reference and review repositories.
// Every operation must see the enclosing transaction except the reconciliation read.
func TestResourceSubmissionTransaction(t *testing.T) {
	ctx := context.Background()
	dsn := os.Getenv("CANVAS_STREAM_TEST_DSN")
	if dsn == "" {
		t.Fatal("CANVAS_STREAM_TEST_DSN must point to an isolated migrated Canvas database")
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	store := transaction.New(pool)
	projects, resources, assets, reviews := project.NewRepository(store), resource.NewRepository(store), asset.NewRepository(store), benefitpackage.NewRepository(store)
	id := func() string { return uuid.Must(uuid.NewV7()).String() }
	tenant, workspace := id(), id()
	now := time.Now().UTC().Truncate(time.Millisecond)
	parent := projectdomain.Project{
		ID:          id(),
		TenantID:    tenant,
		WorkspaceID: &workspace,
		Name:        "submission",
		CreatedBy:   "author",
		MemberIDs:   []string{"member"},
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	item := resourcedomain.Resource{
		ID:          id(),
		TenantID:    tenant,
		WorkspaceID: &workspace,
		OwnerType:   resourcedomain.OwnerProject,
		OwnerID:     parent.ID,
		Type:        resourcedomain.TypeCharacter,
		Name:        "person",
		Revision:    1,
		CreatedBy:   "author",
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	upload := assetdomain.Asset{
		ID:               id(),
		TenantID:         tenant,
		WorkspaceID:      &workspace,
		OwnerType:        assetdomain.OwnerResource,
		OwnerID:          item.ID,
		CreationKey:      "upload",
		SourceAssetID:    id(),
		SourceRevisionID: id(),
		MediaType:        assetdomain.MediaImage,
		ContentType:      "image/png",
		CreatedBy:        "author",
		CreatedAt:        now,
	}
	slot := resourcedomain.ResourceAsset{
		ID:             id(),
		ResourceID:     item.ID,
		Name:           "portrait",
		SequenceNo:     1,
		SourceType:     resourcedomain.SourceUpload,
		CurrentAssetID: upload.ID,
		MediaType:      upload.MediaType,
		Revision:       1,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	projScope := projectapp.Scope{TenantID: tenant, WorkspaceID: &workspace, CallerID: "member", Access: projectapp.AccessMember}
	assetScope := assetapp.Scope{TenantID: tenant, WorkspaceID: &workspace}
	refScope := assetapp.ReferenceScope{TenantID: tenant, WorkspaceID: &workspace}
	owner := assetapp.ReferenceOwner{Type: assetapp.ReferenceOwnerResourceAssetRevision, Key: slot.ID}
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	rollback := errors.New("roll back test data")
	err = store.WithinTransaction(ctx, func(ctx context.Context) error {
		check(projects.Create(ctx, parent))
		// A membership with an inconsistent tenant must neither grant access nor
		// appear in the project returned to legitimate members.
		_, err := store.DB(ctx).Exec(ctx, `INSERT INTO project_members(tenant_id,workspace_id,project_id,user_id,created_at,deleted_at)
            VALUES($1,$2,$3,$4,$5,0)`, id(), workspace, parent.ID, "foreign", now)
		check(err)
		foreign := projScope
		foreign.CallerID = "foreign"
		if _, err := projects.Get(ctx, foreign, parent.ID); !errors.Is(err, projectapp.ErrNotFound) {
			t.Fatalf("foreign membership: %v", err)
		}
		found, err := projects.Get(ctx, projScope, parent.ID)
		check(err)
		if !slices.Equal(found.MemberIDs, parent.MemberIDs) {
			t.Fatalf("members = %v", found.MemberIDs)
		}
		check(resources.ValidateCreate(ctx, item))
		check(resources.Create(ctx, item))
		check(assets.Create(ctx, upload))
		if _, err := assets.GetCommitted(ctx, assetScope, upload.ID); !errors.Is(err, assetapp.ErrNotFound) {
			t.Fatalf("uncommitted reconciliation read = %v", err)
		}
		check(resources.CreateResourceAsset(ctx, slot, upload.ID))
		check(assets.AcquireReferences(ctx, refScope, owner, []string{upload.ID, upload.ID}, now))
		check(assets.ReleaseReferences(ctx, refScope, owner, []string{upload.ID}))
		check(assets.AcquireReferences(ctx, refScope, owner, []string{upload.ID}, now))
		refs, err := assets.BatchGetReferencedAssets(ctx, assetScope, []assetapp.AssetReference{{Owner: owner, AssetID: upload.ID}})
		check(err)
		if len(refs) != 1 || refs[0].Asset.ID != upload.ID {
			t.Fatalf("restored references = %v", refs)
		}
		reserve := reviewapp.ReserveAssetReviewInput{
			ID:          id(),
			TaskRunID:   id(),
			TenantID:    tenant,
			WorkspaceID: &workspace,
			ProjectID:   parent.ID,
			PackageID:   "package",
			PackageName: "Review",
			AssetID:     upload.ID,
			ModelIDs:    []string{"model"},
			Now:         now,
		}
		result, err := reviews.ReplaceAssetReview(ctx, reserve)
		check(err)
		if !slices.Equal(result.Current.ModelIDs, reserve.ModelIDs) {
			t.Fatalf("review models = %v", result.Current.ModelIDs)
		}
		check(reviews.SetAssetReviewReservation(ctx, reserve.ID, "quota", now))
		check(reviews.MarkAssetReviewSubmissionStarted(ctx, reserve.ID, reserve.TaskRunID, now))
		if _, err := reviews.ReplaceAssetReview(ctx, reserve); !errors.Is(err, reviewapp.ErrReviewStateConflict) {
			t.Fatalf("overwrite in-flight review = %v", err)
		}
		check(reviews.MarkAssetReviewProcessing(ctx, reserve.ID, reserve.TaskRunID, "provider", now))
		check(reviews.MarkAssetReviewTerminal(ctx, reserve.ID, assetdomain.ReviewStatusApproved, "", now))
		rows, err := resources.BatchGet(ctx, resourceapp.Scope{TenantID: tenant, WorkspaceID: &workspace}, parent.ID, []string{item.ID})
		check(err)
		if len(rows) != 1 || rows[0].ApprovedResourceAssetCount != 1 {
			t.Fatalf("approved asset counts = %v", rows)
		}
		records, err := reviews.RetireAssetReviews(ctx, assetScope, upload.ID, now)
		check(err)
		if len(records) != 1 || records[0].ID != reserve.ID {
			t.Fatalf("retired reviews = %v", records)
		}
		jobs, err := reviews.ClaimReviewCleanup(ctx, now, now.Add(time.Minute), 100)
		check(err)
		i := slices.IndexFunc(jobs, func(job reviewapp.ReviewCleanupOutbox) bool { return job.ReviewID == reserve.ID })
		if i < 0 {
			t.Fatal("missing review cleanup job")
		}
		stale := jobs[i]
		stale.StateVersion--
		if ok, err := reviews.CompleteReviewCleanup(ctx, stale, now); err != nil || ok {
			t.Fatalf("stale lease completed = %t, %v", ok, err)
		}
		if ok, err := reviews.CompleteReviewCleanup(ctx, jobs[i], now); err != nil || !ok {
			t.Fatalf("current lease completed = %t, %v", ok, err)
		}
		return rollback
	})
	if !errors.Is(err, rollback) {
		t.Fatal(err)
	}
	if _, err := projects.Get(ctx, projScope, parent.ID); !errors.Is(err, projectapp.ErrNotFound) {
		t.Fatalf("rolled-back project read = %v", err)
	}
}
