package httpapi

import (
	"encoding/json"
	"net/http"

	adminapi "github.com/example/monorepo/admin/internal/api/generated/adminapi"
	"github.com/example/monorepo/admin/internal/application"
)

func settingsDTO(value application.CanvasSettings) (adminapi.CanvasSettings, error) {
	var defaults adminapi.CanvasDefaults
	if err := json.Unmarshal(value.Defaults, &defaults); err != nil {
		return adminapi.CanvasSettings{}, err
	}
	return adminapi.CanvasSettings{Revision: value.Revision, Defaults: defaults}, nil
}
func (h *Handler) GetCanvasSettings(w http.ResponseWriter, r *http.Request, _ adminapi.GetCanvasSettingsParams) {
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	value, err := h.Canvas.Get(r.Context(), a.WorkspaceID, a.TenantID)
	if err != nil {
		writeError(w, err)
		return
	}
	dto, err := settingsDTO(value)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, dto)
}
func (h *Handler) UpdateCanvasSettings(w http.ResponseWriter, r *http.Request, _ adminapi.UpdateCanvasSettingsParams) {
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	var body adminapi.UpdateCanvasSettings
	if err = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
		writeError(w, application.BadRequest(err.Error()))
		return
	}
	raw, err := json.Marshal(body.Defaults)
	if err != nil {
		writeError(w, err)
		return
	}
	value, err := h.Canvas.Update(r.Context(), a, body.ExpectedRevision, raw)
	if err != nil {
		writeError(w, err)
		return
	}
	dto, err := settingsDTO(value)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, dto)
}
