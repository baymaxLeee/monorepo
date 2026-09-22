package projectaccess

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"math/rand/v2"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	applicationprojectaccess "github.com/example/monorepo/canvas/internal/application/projectaccess"
	"github.com/example/monorepo/canvas/internal/infrastructure/observability/logcontext"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
	platformlogger "github.com/example/monorepo/canvas/pkg/platform/logger"
)

const (
	memberCacheKeyPrefix     = "agentframe:project-members:v2:members:"
	generationCacheKeyPrefix = "agentframe:project-members:v2:generation:"
	cacheSentinel            = "\x00loaded"
	minCacheTTL              = 45 * time.Second
	maxCacheTTL              = 75 * time.Second
	maxCacheFillAttempts     = 2
)

var storeMembersScript = redis.NewScript(`
local generation = redis.call('GET', KEYS[1])
if not generation then
  generation = '0'
end
if generation ~= ARGV[1] then
  return 0
end
redis.call('DEL', KEYS[2])
for index = 3, #ARGV do
  redis.call('SADD', KEYS[2], ARGV[index])
end
redis.call('EXPIRE', KEYS[2], ARGV[2])
return 1
`)

var invalidateMembersScript = redis.NewScript(`
redis.call('INCR', KEYS[1])
redis.call('DEL', KEYS[2])
return 1
`)

var ErrProjectNotFound = applicationprojectaccess.ErrProjectNotFound
var ErrForbidden = applicationprojectaccess.ErrForbidden

type Checker struct {
	db    *gorm.DB
	cache redis.UniversalClient
	log   *zap.Logger
	draw  func(int64) int64
}

func NewChecker(db *gorm.DB, cache redis.UniversalClient, log *zap.Logger) *Checker {
	checker := newChecker(db, cache, rand.Int64N)
	checker.log = log
	return checker
}

func newChecker(db *gorm.DB, cache redis.UniversalClient, draw func(int64) int64) *Checker {
	return &Checker{db: db, cache: cache, draw: draw}
}

func (c *Checker) Check(
	ctx context.Context,
	tenantID string,
	workspaceID *string,
	userID string,
	projectID string,
) error {
	if c == nil || c.db == nil || tenantID == "" || userID == "" || projectID == "" {
		return ErrProjectNotFound
	}
	projectUUID, err := persistenceid.Parse(projectID)
	if err != nil {
		return ErrProjectNotFound
	}
	canonicalProjectID := projectUUID.String()
	keys := c.cacheKeys(tenantID, workspaceID, canonicalProjectID)

	for attempt := 0; attempt < maxCacheFillAttempts; attempt++ {
		if result, hit := c.readMembership(ctx, keys.members, userID, tenantID, workspaceID, canonicalProjectID); hit {
			return result
		}

		generation, cacheable := c.readGeneration(ctx, keys.generation, tenantID, workspaceID, canonicalProjectID)
		members, loadErr := c.loadMembers(ctx, tenantID, workspaceID, projectUUID)
		if loadErr != nil {
			return loadErr
		}
		if !cacheable {
			return membershipResult(members, userID)
		}
		stored, storeErr := c.storeMembers(ctx, keys, generation, members)
		if storeErr != nil {
			c.logCacheError(ctx, tenantID, workspaceID, canonicalProjectID, "write", storeErr)
			return membershipResult(members, userID)
		}
		if stored {
			return membershipResult(members, userID)
		}
	}

	// Repeated invalidations favor database truth and skip another cache fill.
	members, err := c.loadMembers(ctx, tenantID, workspaceID, projectUUID)
	if err != nil {
		return err
	}
	return membershipResult(members, userID)
}

func (c *Checker) Invalidate(ctx context.Context, tenantID string, workspaceID *string, projectID string) error {
	if c == nil || c.cache == nil {
		return nil
	}
	projectUUID, err := persistenceid.Parse(projectID)
	if err != nil {
		return ErrProjectNotFound
	}
	keys := c.cacheKeys(tenantID, workspaceID, projectUUID.String())
	return invalidateMembersScript.Run(ctx, c.cache, []string{keys.generation, keys.members}).Err()
}

func (c *Checker) loadMembers(
	ctx context.Context,
	tenantID string,
	workspaceID *string,
	projectUUID persistenceid.UUID,
) ([]string, error) {
	db := persistencetransaction.DB(ctx, c.db)
	projectQuery := db.Table("projects").Select("id").
		Where("id = ? AND tenant_id = ? AND deleted_at = 0", projectUUID, tenantID)
	projectQuery = applyWorkspaceScope(projectQuery, "projects", workspaceID)
	var project struct{ ID persistenceid.UUID }
	if err := projectQuery.Take(&project).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrProjectNotFound
		}
		return nil, fmt.Errorf("check project access: find project: %w", err)
	}

	memberQuery := db.Table("project_members").Select("user_id").
		Where("project_id = ? AND tenant_id = ? AND deleted_at = 0", projectUUID, tenantID)
	memberQuery = applyWorkspaceScope(memberQuery, "project_members", workspaceID)
	var members []string
	if err := memberQuery.Order("id ASC").Scan(&members).Error; err != nil {
		return nil, fmt.Errorf("check project access: list members: %w", err)
	}
	return members, nil
}

type cacheKeys struct {
	members    string
	generation string
}

func (c *Checker) storeMembers(ctx context.Context, keys cacheKeys, generation string, members []string) (bool, error) {
	values := make([]any, 0, len(members)+3)
	values = append(values, generation, int64(c.cacheTTL()/time.Second), cacheSentinel)
	for _, member := range members {
		values = append(values, member)
	}
	stored, err := storeMembersScript.Run(ctx, c.cache, []string{keys.generation, keys.members}, values...).Int64()
	return stored == 1, err
}

func (c *Checker) cacheTTL() time.Duration {
	seconds := int64((maxCacheTTL-minCacheTTL)/time.Second) + 1
	return minCacheTTL + time.Duration(c.draw(seconds))*time.Second
}

func (c *Checker) cacheKey(tenantID string, workspaceID *string, projectID string) string {
	return c.cacheKeys(tenantID, workspaceID, projectID).members
}

func (c *Checker) cacheKeys(tenantID string, workspaceID *string, projectID string) cacheKeys {
	material := cacheKeyPart("tenant", tenantID)
	if workspaceID == nil {
		material += cacheKeyPart("workspace-present", "0")
	} else {
		material += cacheKeyPart("workspace-present", "1")
		material += cacheKeyPart("workspace", *workspaceID)
	}
	material += cacheKeyPart("project", projectID)
	digest := fmt.Sprintf("%x", sha256.Sum256([]byte(material)))
	// Both keys are used by one Lua script and must share a Redis Cluster slot.
	hashTag := "{" + digest + "}"
	return cacheKeys{
		members:    memberCacheKeyPrefix + hashTag,
		generation: generationCacheKeyPrefix + hashTag,
	}
}

func cacheKeyPart(label, value string) string {
	return strconv.Itoa(len(label)) + ":" + label + strconv.Itoa(len(value)) + ":" + value
}

func (c *Checker) readMembership(
	ctx context.Context,
	key string,
	userID string,
	tenantID string,
	workspaceID *string,
	projectID string,
) (error, bool) {
	if c.cache == nil {
		return nil, false
	}
	memberships, err := c.cache.SMIsMember(ctx, key, cacheSentinel, userID).Result()
	if err == nil && len(memberships) == 2 && memberships[0] {
		if memberships[1] {
			return nil, true
		}
		return ErrForbidden, true
	}
	if err != nil && !errors.Is(err, redis.Nil) {
		c.logCacheError(ctx, tenantID, workspaceID, projectID, "read", err)
	}
	return nil, false
}

func (c *Checker) readGeneration(
	ctx context.Context,
	key string,
	tenantID string,
	workspaceID *string,
	projectID string,
) (string, bool) {
	if c.cache == nil {
		return "", false
	}
	generation, err := c.cache.Get(ctx, key).Result()
	if errors.Is(err, redis.Nil) {
		return "0", true
	}
	if err != nil {
		c.logCacheError(ctx, tenantID, workspaceID, projectID, "read-generation", err)
		return "", false
	}
	return generation, true
}

func membershipResult(members []string, userID string) error {
	for _, member := range members {
		if member == userID {
			return nil
		}
	}
	return ErrForbidden
}

func (c *Checker) logCacheError(
	ctx context.Context,
	tenantID string,
	workspaceID *string,
	projectID string,
	operation string,
	err error,
) {
	fields := append(logcontext.Fields(logcontext.WithBusiness(ctx, logcontext.Business{
		TenantID: tenantID, WorkspaceID: workspaceID, ProjectID: projectID,
	})), zap.String("operation", operation))
	platformlogger.Error(c.log, "project member cache operation failed", err, fields...)
}

func applyWorkspaceScope(db *gorm.DB, table string, workspaceID *string) *gorm.DB {
	column := clause.Column{Table: table, Name: "workspace_id"}
	if workspaceID == nil {
		return db.Where(clause.Eq{Column: column, Value: nil})
	}
	return db.Where(clause.Eq{Column: column, Value: *workspaceID})
}
