package agent

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"
)

var ErrAgentProvisioning = errors.New("personal Agent is being provisioned")

type AgentService struct {
	store            Store
	runtime          AgentRuntime
	snapshot         *SkillSnapshot
	operationTimeout time.Duration
	now              func() time.Time
	locks            sync.Map
}

func NewAgentService(store Store, runtime AgentRuntime, snapshot *SkillSnapshot, operationTimeout time.Duration, now func() time.Time) *AgentService {
	if now == nil {
		now = time.Now
	}
	return &AgentService{store: store, runtime: runtime, snapshot: snapshot, operationTimeout: operationTimeout, now: now}
}

func (s *AgentService) DeleteByTenant(ctx context.Context, tenantID, operatorID string) error {
	if strings.TrimSpace(tenantID) == "" || strings.TrimSpace(operatorID) == "" {
		return errors.New("tenant ID and operator ID are required")
	}
	// TODO: Delete remote HiBot Agents and environments first once HiBot exposes tenant-scoped cleanup.
	return s.store.DeleteByTenant(ctx, tenantID)
}

func (s *AgentService) DeleteByWorkspace(
	ctx context.Context,
	tenantID string,
	workspaceID string,
	operatorID string,
) error {
	if strings.TrimSpace(tenantID) == "" || strings.TrimSpace(workspaceID) == "" ||
		strings.TrimSpace(operatorID) == "" {
		return errors.New("tenant ID, workspace ID and operator ID are required")
	}
	// TODO: Delete remote HiBot Agents and environments first once HiBot exposes workspace-scoped cleanup.
	return s.store.DeleteByWorkspace(ctx, tenantID, workspaceID)
}

func (s *AgentService) EnsureAgent(ctx context.Context, tenantID, userID string) (PersonalAgent, error) {
	tenantID, userID = strings.TrimSpace(tenantID), strings.TrimSpace(userID)
	if tenantID == "" || userID == "" {
		return PersonalAgent{}, errors.New("tenant ID and user ID are required")
	}
	// The process-local snapshot is only a readiness gate. The database is the
	// cross-replica source of truth after startup reconciliation has succeeded.
	if _, err := s.snapshot.VersionIDs(); err != nil {
		return PersonalAgent{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, s.operationTimeout)
	defer cancel()
	versionIDs, err := s.currentSkillVersionIDs(ctx)
	if err != nil {
		return PersonalAgent{}, err
	}
	spec := currentAgentSpec(versionIDs)
	key := tenantID + "\x00" + userID
	lockValue, _ := s.locks.LoadOrStore(key, &sync.Mutex{})
	lock, ok := lockValue.(*sync.Mutex)
	if !ok {
		return PersonalAgent{}, errors.New("invalid personal Agent lock state")
	}
	lock.Lock()
	defer lock.Unlock()

	existing, getErr := s.store.GetAgent(ctx, tenantID, userID)
	if getErr == nil && existing.Status == AgentStatusReady {
		return s.ensureConfiguration(ctx, existing, spec)
	}
	if getErr != nil && !errors.Is(getErr, ErrAgentNotFound) {
		return PersonalAgent{}, fmt.Errorf("load personal Agent: %w", getErr)
	}

	now := s.now().UTC()
	provisioningToken, err := newProvisioningToken()
	if err != nil {
		return PersonalAgent{}, fmt.Errorf("create personal Agent provisioning token: %w", err)
	}
	scope := AgentScope{TenantID: tenantID, UserID: userID, WorkspaceID: "personal-" + userID}
	claimed, owned, err := s.store.ClaimAgent(ctx, PersonalAgent{
		TenantID: tenantID, UserID: userID, WorkspaceID: scope.WorkspaceID, ProvisioningToken: provisioningToken,
	}, now, now.Add(-3*s.operationTimeout))
	if err != nil {
		return PersonalAgent{}, fmt.Errorf("claim personal Agent: %w", err)
	}
	if !owned {
		if claimed.Status == AgentStatusReady {
			return s.ensureConfiguration(ctx, claimed, spec)
		}
		return PersonalAgent{}, ErrAgentProvisioning
	}

	if claimed.AgentID != "" {
		if err := s.runtime.UpdateAgent(ctx, scope, claimed.AgentID, spec); err != nil {
			s.failProvisioning(ctx, claimed, err)
			return PersonalAgent{}, err
		}
		return s.saveReady(ctx, claimed, spec, false)
	}
	agentID, environmentID, found, findErr := s.runtime.FindAgent(ctx, scope)
	if findErr != nil {
		s.failProvisioning(ctx, claimed, findErr)
		return PersonalAgent{}, findErr
	}
	if found {
		claimed.AgentID, claimed.EnvironmentID = agentID, environmentID
		if err := s.runtime.UpdateAgent(ctx, scope, agentID, spec); err != nil {
			s.failProvisioning(ctx, claimed, err)
			return PersonalAgent{}, err
		}
		return s.saveReady(ctx, claimed, spec, false)
	}

	environmentCreated := false
	if claimed.EnvironmentID == "" {
		environmentID, found, findErr := s.runtime.FindEnvironment(ctx, scope)
		if findErr != nil {
			s.failProvisioning(ctx, claimed, findErr)
			return PersonalAgent{}, findErr
		}
		if !found {
			environmentID, err = s.runtime.CreateEnvironment(ctx, scope)
			if err != nil {
				s.failProvisioning(ctx, claimed, err)
				return PersonalAgent{}, err
			}
			environmentCreated = true
		}
		claimed.EnvironmentID = environmentID
		if err := s.store.SaveProvisioningEnvironment(ctx, claimed); err != nil {
			// A newer lease owner may already have discovered and adopted this
			// deterministic environment, so a stale owner must never delete it.
			if environmentCreated && !errors.Is(err, ErrAgentLeaseLost) {
				s.cleanupEnvironment(ctx, scope, environmentID)
			}
			return PersonalAgent{}, fmt.Errorf("checkpoint personal Agent environment: %w", err)
		}
	}

	createdAgentID, err := s.runtime.CreateAgent(ctx, scope, claimed.EnvironmentID, spec)
	if err != nil {
		if environmentCreated {
			s.cleanupEnvironment(ctx, scope, claimed.EnvironmentID)
			claimed.EnvironmentID = ""
		}
		s.failProvisioning(ctx, claimed, err)
		return PersonalAgent{}, err
	}
	claimed.AgentID = createdAgentID
	return s.saveReady(ctx, claimed, spec, true)
}

func (s *AgentService) saveReady(ctx context.Context, claimed PersonalAgent, spec AgentSpec, agentCreated bool) (PersonalAgent, error) {
	claimed.Status = AgentStatusReady
	claimed.BoundSkillVersionIDs = append([]string(nil), spec.SkillVersionIDs...)
	claimed.PromptVersion = spec.PromptVersion
	if err := s.store.SaveReadyAgent(ctx, claimed); err != nil {
		// SaveReady is fenced by the provisioning token. Once that token is
		// stale, another replica may own the remote Agent found by name.
		if agentCreated && !errors.Is(err, ErrAgentLeaseLost) {
			s.cleanupAgent(ctx, AgentScope{
				TenantID: claimed.TenantID, UserID: claimed.UserID, WorkspaceID: claimed.WorkspaceID,
			}, claimed.AgentID)
		}
		return PersonalAgent{}, fmt.Errorf("save personal Agent: %w", err)
	}
	claimed.ProvisioningToken = ""
	return claimed, nil
}

func (s *AgentService) currentSkillVersionIDs(ctx context.Context) ([]string, error) {
	skills, err := s.store.ListSkills(ctx)
	if err != nil {
		return nil, fmt.Errorf("load current Agent Skill versions: %w", err)
	}
	versionIDs := make([]string, 0, len(skills))
	for _, skill := range skills {
		versionIDs = append(versionIDs, skill.VersionID)
	}
	slices.Sort(versionIDs)
	return versionIDs, nil
}

func (s *AgentService) ensureConfiguration(ctx context.Context, agent PersonalAgent, spec AgentSpec) (PersonalAgent, error) {
	want := append([]string(nil), spec.SkillVersionIDs...)
	slices.Sort(want)
	current := append([]string(nil), agent.BoundSkillVersionIDs...)
	slices.Sort(current)
	if slices.Equal(current, want) && agent.PromptVersion == spec.PromptVersion {
		return agent, nil
	}
	scope := AgentScope{TenantID: agent.TenantID, UserID: agent.UserID, WorkspaceID: agent.WorkspaceID}
	spec.SkillVersionIDs = want
	if err := s.runtime.UpdateAgent(ctx, scope, agent.AgentID, spec); err != nil {
		_ = s.store.SaveAgentError(ctx, agent.TenantID, agent.UserID, err) //nolint:errcheck // The Hibot failure remains the task's primary error.
		return PersonalAgent{}, err
	}
	if err := s.store.SaveAgentConfiguration(ctx, agent.TenantID, agent.UserID, want, spec.PromptVersion); err != nil {
		return PersonalAgent{}, fmt.Errorf("save personal Agent configuration: %w", err)
	}
	agent.BoundSkillVersionIDs = want
	agent.PromptVersion = spec.PromptVersion
	agent.LastError = ""
	return agent, nil
}

func (s *AgentService) failProvisioning(ctx context.Context, claimed PersonalAgent, failure error) {
	recordContext, cancel := context.WithTimeout(context.WithoutCancel(ctx), s.operationTimeout)
	defer cancel()
	_ = s.store.FailProvisioning(recordContext, claimed, failure) //nolint:errcheck // A lost lease or unavailable database cannot replace the provisioning error.
}

func newProvisioningToken() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(value[:]), nil
}

func (s *AgentService) cleanupAgent(parent context.Context, scope AgentScope, agentID string) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(parent), s.operationTimeout)
	defer cancel()
	_ = s.runtime.DeleteAgent(ctx, scope, agentID) //nolint:errcheck // Compensation must not replace the original persistence error.
}

func (s *AgentService) cleanupEnvironment(parent context.Context, scope AgentScope, environmentID string) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(parent), s.operationTimeout)
	defer cancel()
	_ = s.runtime.DeleteEnvironment(ctx, scope, environmentID) //nolint:errcheck // Compensation must not replace the original provisioning error.
}
