package application

import (
	"context"
	"encoding/json"
	"time"

	"github.com/example/monorepo/admin/internal/domain"
)

type AppRepository interface {
	List(context.Context, bool, bool) ([]domain.App, error)
	Get(context.Context, string) (domain.App, error)
	Create(context.Context, domain.App) (domain.App, error)
	Save(context.Context, domain.App) (domain.App, error)
	Delete(context.Context, string) error
}

type BotRepository interface {
	List(context.Context, string, string) ([]domain.Bot, error)
	Get(context.Context, string, string, string) (domain.Bot, error)
	Create(context.Context, string, string, string, string) (domain.Bot, error)
	Save(context.Context, domain.Bot) (domain.Bot, error)
	Delete(context.Context, string, string, string) error
	Skills(context.Context, string, bool) ([]domain.SkillSummary, error)
	AttachSkill(context.Context, string, string, string, string) error
	DetachSkill(context.Context, string, string) error
}

type ProviderRepository interface {
	List(context.Context, string, string) ([]domain.Provider, error)
	Get(context.Context, string, string, string) (domain.Provider, error)
	Default(context.Context, string, string) (domain.Provider, error)
	ByKind(context.Context, string, string, string) (domain.Provider, error)
	Create(context.Context, domain.Provider, bool) (domain.Provider, error)
	Delete(context.Context, string, string, string) (bool, error)
	BulkDelete(context.Context, []string, string, string) (int64, error)
	Save(context.Context, domain.Provider) (domain.Provider, error)
	SetDefault(context.Context, string, string, string) (domain.Provider, error)
}

type SecretCipher interface {
	Encrypt(string) (string, error)
	Decrypt(string) (string, error)
}

type CanvasSettingsStore interface {
	Get(context.Context, string, string) (CanvasSettings, error)
	Update(context.Context, Actor, int, json.RawMessage) (CanvasSettings, error)
}

type ErrorClassifier interface {
	IsNotFound(error) bool
}

// ProviderProbe is the outbound connectivity boundary used by provider tests.
// The application owns the request/result contract; HTTP and SDK details stay in
// an infrastructure adapter selected by bootstrap.
type ProviderProbe interface {
	Probe(context.Context, ProviderProbeRequest) ProviderProbeResult
}

type ProviderProbeRequest struct {
	Kind             string
	ResponsesDialect *string
	BaseURL          string
	APIKey           string
	Model            string
	ExtraBody        map[string]any
}

type ProviderProbeResult struct {
	OK        bool
	LatencyMS *int
	Sample    *string
	Error     *string
}

type SkillRepository interface {
	Transaction(context.Context, func(SkillRepository) error) error
	ListSkills(context.Context, string, string) ([]domain.Skill, error)
	ListSkillsByIDs(context.Context, []string, string, string) ([]domain.Skill, error)
	GetSkill(context.Context, string, string, string, bool) (domain.Skill, error)
	GetSkillByName(context.Context, string, string, string) (domain.Skill, error)
	CreateSkill(context.Context, domain.Skill) (domain.Skill, error)
	SaveSkill(context.Context, domain.Skill) (domain.Skill, error)
	DeleteSkill(context.Context, string) error
	BulkDeleteSkills(context.Context, []string, string, string) (int64, error)
	ListSkillNodes(context.Context, string) ([]domain.SkillNode, error)
	GetSkillNode(context.Context, string, string) (domain.SkillNode, error)
	CreateSkillNode(context.Context, domain.SkillNode) error
	SaveSkillNode(context.Context, domain.SkillNode) error
	DeleteSkillNode(context.Context, string, string) error
	DeleteAllSkillNodes(context.Context, string) error
	SiblingNameExists(context.Context, string, *string, string, string) (bool, error)
	ListPublishedSkillNodes(context.Context, string) ([]domain.PublishedSkillNode, error)
	ReplacePublishedSkillNodes(context.Context, string) error
	UpsertAssetClaim(context.Context, AssetClaim) error
}

type AssetClaim struct {
	TenantID, WorkspaceID, OwnerType, OwnerID, Slot string
	AssetID, RevisionID, Kind, DesiredState         string
}

type SkillAssetStore interface {
	CreateUploadSession(context.Context, CreateUploadSession) (UploadSession, error)
	GetUploadSession(context.Context, string, string, string) (UploadSession, error)
	DescribeRevision(context.Context, string, string, string, string) (AssetRevision, error)
	DeliveryURL(context.Context, string, string, string, string) (string, error)
	DownloadRevision(context.Context, string, string, AssetRevision, int64) ([]byte, error)
	UploadAsset(context.Context, UploadAsset) (AssetRevision, error)
}

type UploadAsset struct {
	TenantID, WorkspaceID, UserID string
	Filename, MediaType           string
	IdempotencyKey                string
	Content                       []byte
}

type CreateUploadSession struct {
	TenantID, WorkspaceID, UserID, IntentID string
	Filename, MediaType, Category           string
	SizeBytes                               int64
}

type UploadSession struct {
	UploadSessionID, IntentID, State, UserID string
	Category, Filename, MediaType, UploadURL string
	SizeBytes                                int64
	ExpiresAt                                time.Time
	AssetID, RevisionID                      *string
}

type AssetRevision struct {
	AssetID, RevisionID, Category, Filename, MediaType, SHA256, CreatedBy string
	SizeBytes                                                             int64
}

type BenefitPackageRepository interface {
	Transaction(context.Context, func(BenefitPackageRepository) error) error
	ListBenefitPackages(context.Context, string, string) ([]domain.BenefitPackage, error)
	GetBenefitPackage(context.Context, string, string, string, bool) (domain.BenefitPackage, error)
	CreateBenefitPackage(context.Context, domain.BenefitPackage) error
	SaveBenefitPackage(context.Context, domain.BenefitPackage) error
	ReplaceBenefitPackageModels(context.Context, domain.BenefitPackage, []string) error
	ReviewUsage(context.Context, string, string) (map[string][2]int64, error)
	GetReviewReservation(context.Context, string, bool) (domain.ReviewReservation, error)
	GetReviewReservationByOperation(context.Context, string, bool) (domain.ReviewReservation, error)
	GetActiveReviewReservation(context.Context, string, string, string, bool) (domain.ReviewReservation, error)
	CreateReviewReservation(context.Context, domain.ReviewReservation) error
	SaveReviewReservation(context.Context, domain.ReviewReservation) error
	GetReviewCleanup(context.Context, string, bool) (domain.ReviewCleanup, error)
	CreateReviewCleanup(context.Context, domain.ReviewCleanup) error
	SaveReviewCleanup(context.Context, domain.ReviewCleanup) error
	CountPendingReviewCleanups(context.Context, string) (int64, error)
	ListAssetGroupCleanups(context.Context, string, string) ([]domain.AssetGroupCleanup, error)
	GetAssetGroupCleanup(context.Context, string, string, string, bool) (domain.AssetGroupCleanup, error)
	CreateAssetGroupCleanup(context.Context, domain.AssetGroupCleanup) error
	SaveAssetGroupCleanup(context.Context, domain.AssetGroupCleanup) error
}

type AssetGroupService interface {
	Create(context.Context, AssetGroupCredentials, string, string) (string, error)
	Delete(context.Context, AssetGroupCredentials, string) error
	CreateAsset(context.Context, AssetGroupCredentials, string, string, string, string) (string, error)
	GetAsset(context.Context, AssetGroupCredentials, string) (string, string, error)
	DeleteAsset(context.Context, AssetGroupCredentials, string) error
}

type AssetGroupCredentials struct {
	ProjectName, AccessKeyID, SecretAccessKey string
}
