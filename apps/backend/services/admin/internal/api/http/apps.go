package httpapi

import (
	"encoding/json"
	"net/http"

	adminapi "github.com/example/monorepo/admin/internal/api/generated/adminapi"
	"github.com/example/monorepo/admin/internal/application"
	"github.com/example/monorepo/admin/internal/domain"
	"github.com/gin-gonic/gin"
)

func appDTO(a domain.App) adminapi.App {
	return adminapi.App{Id: a.ID, Title: a.Title, BasePath: a.BasePath, RemoteName: a.RemoteName, ExposeKey: a.ExposeKey, Entry: a.Entry, RequiresAdmin: a.RequiresAdmin, IsEnabled: a.IsEnabled, SortOrder: a.SortOrder, CreatedAt: a.CreatedAt.UTC().Format(timeLayout), UpdatedAt: a.UpdatedAt.UTC().Format(timeLayout)}
}
func (h *Handler) ListApps(c *gin.Context, _ adminapi.ListAppsParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	values, err := h.Apps.List(r.Context(), a)
	if err != nil {
		writeError(w, err)
		return
	}
	out := make([]adminapi.App, 0, len(values))
	for _, value := range values {
		out = append(out, appDTO(value))
	}
	writeJSON(w, 200, out)
}
func (h *Handler) GetApp(c *gin.Context, id string, _ adminapi.GetAppParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	value, err := h.Apps.Get(r.Context(), a, id)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, appDTO(value))
}
func (h *Handler) CreateApp(c *gin.Context, _ adminapi.CreateAppParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	var body adminapi.CreateAppInput
	if err = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
		writeError(w, application.BadRequest(err.Error()))
		return
	}
	expose, entry, required, enabled, order := "./routes", "", true, true, 0
	if body.ExposeKey != nil {
		expose = *body.ExposeKey
	}
	if body.Entry != nil {
		entry = *body.Entry
	}
	if body.RequiresAdmin != nil {
		required = *body.RequiresAdmin
	}
	if body.IsEnabled != nil {
		enabled = *body.IsEnabled
	}
	if body.SortOrder != nil {
		order = *body.SortOrder
	}
	value, err := h.Apps.Create(r.Context(), a, domain.App{ID: body.Id, Title: body.Title, BasePath: body.BasePath, RemoteName: body.RemoteName, ExposeKey: expose, Entry: entry, RequiresAdmin: required, IsEnabled: enabled, SortOrder: order})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 201, appDTO(value))
}
func (h *Handler) UpdateApp(c *gin.Context, id string, _ adminapi.UpdateAppParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	existing, err := h.Apps.Get(r.Context(), application.Actor{Roles: map[string]bool{"super_admin": true}}, id)
	if err != nil {
		writeError(w, err)
		return
	}
	var body adminapi.UpdateAppInput
	if err = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
		writeError(w, application.BadRequest(err.Error()))
		return
	}
	if body.Title != nil {
		existing.Title = *body.Title
	}
	if body.BasePath != nil {
		existing.BasePath = *body.BasePath
	}
	if body.RemoteName != nil {
		existing.RemoteName = *body.RemoteName
	}
	if body.ExposeKey != nil {
		existing.ExposeKey = *body.ExposeKey
	}
	if body.Entry != nil {
		existing.Entry = *body.Entry
	}
	if body.RequiresAdmin != nil {
		existing.RequiresAdmin = *body.RequiresAdmin
	}
	if body.IsEnabled != nil {
		existing.IsEnabled = *body.IsEnabled
	}
	if body.SortOrder != nil {
		existing.SortOrder = *body.SortOrder
	}
	value, err := h.Apps.Update(r.Context(), a, existing)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, appDTO(value))
}
func (h *Handler) DeleteApp(c *gin.Context, id string, _ adminapi.DeleteAppParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	if err == nil {
		err = h.Apps.Delete(r.Context(), a, id)
	}
	if err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(204)
}
