package httpapi

import (
	"encoding/json"
	"net/http"

	adminapi "github.com/example/monorepo/admin/internal/api/generated/adminapi"
	"github.com/example/monorepo/admin/internal/application"
	"github.com/example/monorepo/admin/internal/domain"
)

func botDTO(b domain.Bot) adminapi.Bot {
	tone := adminapi.BotTone(b.Tone)
	questions := b.SuggestedQuestions
	return adminapi.Bot{Id: b.ID, UserId: b.UserID, WorkspaceId: b.WorkspaceID, TenantId: b.TenantID, Username: b.UserID, Name: b.Name, RoleDescription: b.RoleDescription, DomainDescription: b.DomainDescription, Audience: b.Audience, Tone: &tone, WelcomeMessage: b.WelcomeMessage, SuggestedQuestions: &questions, Status: adminapi.BotStatus(b.Status), TextProviderId: b.TextProviderID, ImageProviderId: b.ImageProviderID, VideoProviderId: b.VideoProviderID, CreatedAt: b.CreatedAt.UTC().Format(timeLayout), UpdatedAt: b.UpdatedAt.UTC().Format(timeLayout)}
}
func skillSummaryDTO(s domain.SkillSummary) adminapi.SkillSummary {
	var published *string
	if s.PublishedAt != nil {
		value := s.PublishedAt.UTC().Format(timeLayout)
		published = &value
	}
	return adminapi.SkillSummary{Id: s.ID, UserId: s.UserID, WorkspaceId: s.WorkspaceID, TenantId: s.TenantID, Username: s.Username, Name: s.Name, Description: s.Description, Status: adminapi.SkillSummaryStatus(s.Status), IsEnabled: s.IsEnabled, HasUnpublishedChanges: s.HasUnpublishedChanges, PublishedAt: published, CreatedAt: s.CreatedAt.UTC().Format(timeLayout), UpdatedAt: s.UpdatedAt.UTC().Format(timeLayout)}
}
func skillSummaryDTOs(values []domain.SkillSummary) []adminapi.SkillSummary {
	out := make([]adminapi.SkillSummary, 0, len(values))
	for _, value := range values {
		out = append(out, skillSummaryDTO(value))
	}
	return out
}
func (h *Handler) ListBots(w http.ResponseWriter, r *http.Request, _ adminapi.ListBotsParams) {
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	values, err := h.Bots.List(r.Context(), a)
	if err != nil {
		writeError(w, err)
		return
	}
	out := make([]adminapi.Bot, 0, len(values))
	for _, value := range values {
		out = append(out, botDTO(value))
	}
	writeJSON(w, 200, out)
}
func (h *Handler) GetBot(w http.ResponseWriter, r *http.Request, id string, _ adminapi.GetBotParams) {
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	value, err := h.Bots.Get(r.Context(), a, id)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, botDTO(value))
}
func (h *Handler) CreateBot(w http.ResponseWriter, r *http.Request, _ adminapi.CreateBotParams) {
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	var body adminapi.CreateBotInput
	if err = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
		writeError(w, application.BadRequest(err.Error()))
		return
	}
	value, err := h.Bots.Create(r.Context(), a, body.Name)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 201, botDTO(value))
}
func (h *Handler) UpdateBot(w http.ResponseWriter, r *http.Request, id string, _ adminapi.UpdateBotParams) {
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	value, err := h.Bots.Get(r.Context(), a, id)
	if err != nil {
		writeError(w, err)
		return
	}
	var raw map[string]json.RawMessage
	if err = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&raw); err != nil {
		writeError(w, application.BadRequest(err.Error()))
		return
	}
	decode := func(name string, target any) {
		if data, ok := raw[name]; ok {
			_ = json.Unmarshal(data, target)
		}
	}
	decode("name", &value.Name)
	decode("status", &value.Status)
	decode("tone", &value.Tone)
	if _, ok := raw["role_description"]; ok {
		decode("role_description", &value.RoleDescription)
	}
	if _, ok := raw["domain_description"]; ok {
		decode("domain_description", &value.DomainDescription)
	}
	if _, ok := raw["audience"]; ok {
		decode("audience", &value.Audience)
	}
	if _, ok := raw["welcome_message"]; ok {
		decode("welcome_message", &value.WelcomeMessage)
	}
	if _, ok := raw["suggested_questions"]; ok {
		decode("suggested_questions", &value.SuggestedQuestions)
	}
	if _, ok := raw["text_provider_id"]; ok {
		decode("text_provider_id", &value.TextProviderID)
	}
	if _, ok := raw["image_provider_id"]; ok {
		decode("image_provider_id", &value.ImageProviderID)
	}
	if _, ok := raw["video_provider_id"]; ok {
		decode("video_provider_id", &value.VideoProviderID)
	}
	value, err = h.Bots.Save(r.Context(), a, value)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, botDTO(value))
}
func (h *Handler) DeleteBot(w http.ResponseWriter, r *http.Request, id string, _ adminapi.DeleteBotParams) {
	a, err := actor(r)
	if err == nil {
		err = h.Bots.Delete(r.Context(), a, id)
	}
	if err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(204)
}
func (h *Handler) ListBotSkills(w http.ResponseWriter, r *http.Request, id string, _ adminapi.ListBotSkillsParams) {
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	values, err := h.Bots.Skills(r.Context(), a, id, false)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, skillSummaryDTOs(values))
}
func (h *Handler) AttachBotSkill(w http.ResponseWriter, r *http.Request, id string, _ adminapi.AttachBotSkillParams) {
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	var body adminapi.AttachSkillInput
	if err = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
		writeError(w, application.BadRequest(err.Error()))
		return
	}
	values, err := h.Bots.Attach(r.Context(), a, id, body.SkillId)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, skillSummaryDTOs(values))
}
func (h *Handler) DetachBotSkill(w http.ResponseWriter, r *http.Request, id, skillID string, _ adminapi.DetachBotSkillParams) {
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	values, err := h.Bots.Detach(r.Context(), a, id, skillID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, skillSummaryDTOs(values))
}
