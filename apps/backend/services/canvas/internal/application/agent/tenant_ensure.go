package agent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"slices"
	"sort"
	"strings"
)

var (
	ErrRemoteTenantAgentNotFound = errors.New("remote tenant Hibot Agent not found")
	ErrTenantAgentIdentity       = errors.New("tenant Hibot Agent identity mismatch")
)

type TenantAgentAdmission interface {
	CheckTenantAgentWrite(context.Context, string) error
}

type TenantAgentProvisioningLock interface {
	WithinTenantAgentLock(context.Context, string, string, func(context.Context) error) error
}

type TenantAgentRuntime interface {
	GetTenantAgent(context.Context, TenantAgentIdentity, string) (RemoteTenantAgent, error)
	CreateTenantAgent(context.Context, TenantAgentIdentity, TenantAgentConfiguration) (string, error)
	UpdateTenantAgent(context.Context, TenantAgentIdentity, string, TenantAgentConfiguration) error
}

type TenantAgentIdentity struct {
	TenantID    string
	ProductCode string
	WorkspaceID string
	UserID      string
}

type TenantAgentConfiguration struct {
	SkillIDs      []string
	SystemPrompt  string
	PromptVersion string
	BindingDigest string
}

type RemoteTenantAgent struct {
	TenantAgentIdentity
	AgentID      string
	SkillIDs     []string
	SystemPrompt string
}

type TenantAgentEnsurer struct {
	store  TenantAgentStore
	skills interface {
		ListDefaultPresetSkills(context.Context) ([]PresetSkill, error)
	}
	admission     TenantAgentAdmission
	lock          TenantAgentProvisioningLock
	transactions  TransactionManager
	runtime       TenantAgentRuntime
	prompt        string
	promptVersion string
}

func NewTenantAgentEnsurer(
	store TenantAgentStore,
	skills interface {
		ListDefaultPresetSkills(context.Context) ([]PresetSkill, error)
	},
	admission TenantAgentAdmission,
	lock TenantAgentProvisioningLock,
	transactions TransactionManager,
	runtime TenantAgentRuntime,
	prompt string,
	promptVersion string,
) *TenantAgentEnsurer {
	return &TenantAgentEnsurer{
		store: store, skills: skills, admission: admission, lock: lock,
		transactions: transactions, runtime: runtime, prompt: prompt, promptVersion: promptVersion,
	}
}

func (s *TenantAgentEnsurer) EnsureTenantAgent(ctx context.Context, tenantID string) (TenantAgent, error) {
	if err := s.admission.CheckTenantAgentWrite(ctx, tenantID); err != nil {
		return TenantAgent{}, err
	}
	identity := systemTenantAgentIdentity(tenantID)
	desired, err := s.desiredConfiguration(ctx)
	if err != nil {
		return TenantAgent{}, err
	}
	local, err := s.store.GetTenantAgent(ctx, tenantID, ProductCodeAgentFrame)
	if err == nil {
		remote, remoteErr := s.runtime.GetTenantAgent(ctx, identity, local.AgentID)
		if remoteErr == nil {
			if err := validateRemoteTenantAgent(identity, remote); err != nil {
				return TenantAgent{}, err
			}
			if tenantAgentConfigurationMatches(remote, desired) {
				if tenantAgentMappingMatches(local, desired) {
					return local, nil
				}
				return s.commitMapping(ctx, identity, local.AgentID, desired)
			}
		} else if !errors.Is(remoteErr, ErrRemoteTenantAgentNotFound) {
			return TenantAgent{}, remoteErr
		}
	} else if !errors.Is(err, ErrTenantAgentNotFound) {
		return TenantAgent{}, err
	}

	var ensured TenantAgent
	err = s.lock.WithinTenantAgentLock(ctx, tenantID, ProductCodeAgentFrame, func(lockCtx context.Context) error {
		var ensureErr error
		ensured, ensureErr = s.ensureLocked(lockCtx, identity)
		return ensureErr
	})
	return ensured, err
}

func (s *TenantAgentEnsurer) ensureLocked(ctx context.Context, identity TenantAgentIdentity) (TenantAgent, error) {
	if err := s.admission.CheckTenantAgentWrite(ctx, identity.TenantID); err != nil {
		return TenantAgent{}, err
	}
	desired, err := s.desiredConfiguration(ctx)
	if err != nil {
		return TenantAgent{}, err
	}
	local, err := s.store.GetTenantAgent(ctx, identity.TenantID, identity.ProductCode)
	switch {
	case err == nil:
		remote, remoteErr := s.runtime.GetTenantAgent(ctx, identity, local.AgentID)
		if remoteErr == nil {
			if err := validateRemoteTenantAgent(identity, remote); err != nil {
				return TenantAgent{}, err
			}
			if tenantAgentConfigurationMatches(remote, desired) {
				if tenantAgentMappingMatches(local, desired) {
					return local, nil
				}
				return s.commitMapping(ctx, identity, local.AgentID, desired)
			}
			if err := s.runtime.UpdateTenantAgent(ctx, identity, local.AgentID, desired); err != nil {
				return TenantAgent{}, err
			}
			return s.commitMapping(ctx, identity, local.AgentID, desired)
		}
		if !errors.Is(remoteErr, ErrRemoteTenantAgentNotFound) {
			return TenantAgent{}, remoteErr
		}
		if err := s.store.DeleteTenantAgent(ctx, identity.TenantID, identity.ProductCode, local.AgentID); err != nil {
			return TenantAgent{}, err
		}
	case errors.Is(err, ErrTenantAgentNotFound):
	default:
		return TenantAgent{}, err
	}

	agentID, err := s.runtime.CreateTenantAgent(ctx, identity, desired)
	if err != nil {
		return TenantAgent{}, err
	}
	if strings.TrimSpace(agentID) == "" {
		return TenantAgent{}, errors.New("create tenant Hibot Agent returned an empty ID")
	}
	return s.commitMapping(ctx, identity, agentID, desired)
}

func tenantAgentMappingMatches(local TenantAgent, desired TenantAgentConfiguration) bool {
	return local.BindingDigest == desired.BindingDigest && local.PromptVersion == desired.PromptVersion
}

func (s *TenantAgentEnsurer) commitMapping(
	ctx context.Context,
	identity TenantAgentIdentity,
	agentID string,
	desired TenantAgentConfiguration,
) (TenantAgent, error) {
	agent := TenantAgent{
		TenantID: identity.TenantID, ProductCode: identity.ProductCode, WorkspaceID: identity.WorkspaceID,
		AgentID: agentID, CreatedByUserID: identity.UserID,
		BindingDigest: desired.BindingDigest, PromptVersion: desired.PromptVersion,
	}
	err := s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		if err := s.admission.CheckTenantAgentWrite(txCtx, identity.TenantID); err != nil {
			return err
		}
		return s.store.UpsertTenantAgent(txCtx, agent)
	})
	return agent, err
}

func (s *TenantAgentEnsurer) desiredConfiguration(ctx context.Context) (TenantAgentConfiguration, error) {
	skills, err := s.skills.ListDefaultPresetSkills(ctx)
	if err != nil {
		return TenantAgentConfiguration{}, err
	}
	ids := make([]string, 0, len(skills))
	for _, skill := range skills {
		ids = append(ids, skill.AssetCenterSkillID)
	}
	sort.Strings(ids)
	ids = slices.Compact(ids)
	return TenantAgentConfiguration{
		SkillIDs: ids, SystemPrompt: s.prompt, PromptVersion: s.promptVersion,
		BindingDigest: BindingDigest(ids),
	}, nil
}

func BindingDigest(skillIDs []string) string {
	ids := append([]string(nil), skillIDs...)
	sort.Strings(ids)
	ids = slices.Compact(ids)
	var payload string
	for _, id := range ids {
		payload += fmt.Sprintf("%d:%s\x00", len(id), id)
	}
	digest := sha256.Sum256([]byte(payload))
	return hex.EncodeToString(digest[:])
}

func systemTenantAgentIdentity(tenantID string) TenantAgentIdentity {
	return TenantAgentIdentity{
		TenantID: tenantID, ProductCode: ProductCodeAgentFrame,
		WorkspaceID: SystemWorkspaceID, UserID: SystemUserID,
	}
}

func validateRemoteTenantAgent(expected TenantAgentIdentity, remote RemoteTenantAgent) error {
	if remote.TenantID != expected.TenantID || remote.ProductCode != expected.ProductCode ||
		remote.WorkspaceID != expected.WorkspaceID {
		return ErrTenantAgentIdentity
	}
	return nil
}

func tenantAgentConfigurationMatches(remote RemoteTenantAgent, desired TenantAgentConfiguration) bool {
	remoteSkills := append([]string(nil), remote.SkillIDs...)
	sort.Strings(remoteSkills)
	remoteSkills = slices.Compact(remoteSkills)
	return slices.Equal(remoteSkills, desired.SkillIDs) && remote.SystemPrompt == desired.SystemPrompt
}
