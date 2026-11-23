package application

import "context"

type MemoryCategory string

const (
	MemoryPreference  MemoryCategory = "preference"
	MemoryProfile     MemoryCategory = "profile"
	MemoryProject     MemoryCategory = "project"
	MemoryInstruction MemoryCategory = "instruction"
)

type UserMemory struct {
	ID         string         `json:"id"`
	Category   MemoryCategory `json:"category"`
	Content    string         `json:"content"`
	Confidence int32          `json:"confidence"`
}

type MemoryCandidate struct {
	ID           string         `json:"id"`
	Category     MemoryCategory `json:"category"`
	Content      string         `json:"content"`
	Reason       *string        `json:"reason"`
	SupersedesID *string        `json:"supersedesId"`
	CreatedAt    string         `json:"createdAt"`
}

type MemoryRepository interface {
	ListActiveMemories(context.Context, AuthContext) ([]UserMemory, error)
	ListMemoryCandidates(context.Context, AuthContext) ([]MemoryCandidate, error)
	ApproveMemoryCandidate(context.Context, AuthContext, string) (*UserMemory, error)
	RejectMemoryCandidate(context.Context, AuthContext, string) (bool, error)
	UpdateMemoryCandidate(context.Context, AuthContext, string, *MemoryCategory, *string) (*MemoryCandidate, error)
	DeleteMemory(context.Context, AuthContext, string) (bool, error)
}

func (service *Service) memoryRepository() (MemoryRepository, error) {
	repository, ok := service.repository.(MemoryRepository)
	if !ok {
		return nil, &Error{Status: 503, Code: "memory_unavailable", Message: "product memory is unavailable"}
	}
	return repository, nil
}

func (service *Service) ListActiveMemories(ctx context.Context, scope AuthContext) ([]UserMemory, error) {
	repository, err := service.memoryRepository()
	if err != nil {
		return nil, err
	}
	return repository.ListActiveMemories(ctx, scope)
}

func (service *Service) ListMemoryCandidates(ctx context.Context, scope AuthContext) ([]MemoryCandidate, error) {
	repository, err := service.memoryRepository()
	if err != nil {
		return nil, err
	}
	return repository.ListMemoryCandidates(ctx, scope)
}

func (service *Service) ApproveMemoryCandidate(ctx context.Context, scope AuthContext, id string) (*UserMemory, error) {
	repository, err := service.memoryRepository()
	if err != nil {
		return nil, err
	}
	return repository.ApproveMemoryCandidate(ctx, scope, id)
}

func (service *Service) RejectMemoryCandidate(ctx context.Context, scope AuthContext, id string) (bool, error) {
	repository, err := service.memoryRepository()
	if err != nil {
		return false, err
	}
	return repository.RejectMemoryCandidate(ctx, scope, id)
}

func (service *Service) UpdateMemoryCandidate(
	ctx context.Context,
	scope AuthContext,
	id string,
	category *MemoryCategory,
	content *string,
) (*MemoryCandidate, error) {
	repository, err := service.memoryRepository()
	if err != nil {
		return nil, err
	}
	return repository.UpdateMemoryCandidate(ctx, scope, id, category, content)
}

func (service *Service) DeleteMemory(ctx context.Context, scope AuthContext, id string) (bool, error) {
	repository, err := service.memoryRepository()
	if err != nil {
		return false, err
	}
	return repository.DeleteMemory(ctx, scope, id)
}
