package httpapi

import (
	"encoding/json"

	adminapi "github.com/example/monorepo/admin/internal/api/generated/adminapi"
	"github.com/example/monorepo/admin/internal/application"
	"github.com/example/monorepo/admin/internal/domain"
	"github.com/gin-gonic/gin"
)

func benefitDTO(value domain.BenefitPackage) adminapi.BenefitPackage {
	var limit *int
	if value.MaterialLimit != nil {
		converted := int(*value.MaterialLimit)
		limit = &converted
	}
	return adminapi.BenefitPackage{Id: value.ID, IsPreset: value.IsPreset, Name: value.Name, ProjectName: value.ProjectName, HasAccessKeyId: value.AccessKeyIDEncrypted != "", HasSecretAccessKey: value.SecretKeyEncrypted != "", Enabled: value.Enabled, ModelIds: value.ModelIDs, MaterialUsed: int(value.MaterialUsed), MaterialReserved: int(value.MaterialReserved), MaterialLimit: limit, Revision: int(value.Revision), CreatedBy: value.CreatedBy, UpdatedBy: value.UpdatedBy, CreatedAt: value.CreatedAt.UTC().Format(timeLayout), UpdatedAt: value.UpdatedAt.UTC().Format(timeLayout)}
}
func cleanupDTO(value domain.AssetGroupCleanup) adminapi.AssetGroupCleanup {
	var completed *string
	if value.CompletedAt != nil {
		v := value.CompletedAt.UTC().Format(timeLayout)
		completed = &v
	}
	return adminapi.AssetGroupCleanup{Id: value.ID, BenefitPackageId: value.BenefitPackageID, AssetGroupId: value.AssetGroupID, Status: value.Status, Attempts: value.Attempts, LastError: value.LastError, CreatedAt: value.CreatedAt.UTC().Format(timeLayout), UpdatedAt: value.UpdatedAt.UTC().Format(timeLayout), CompletedAt: completed}
}
func (h *Handler) ListBenefitPackages(c *gin.Context, p adminapi.ListBenefitPackagesParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	available := false
	if p.AvailableOnly != nil {
		available = *p.AvailableOnly
	}
	values, err := h.Benefits.List(r.Context(), a, available)
	if err != nil {
		writeError(w, err)
		return
	}
	out := make([]adminapi.BenefitPackage, 0, len(values))
	for _, v := range values {
		out = append(out, benefitDTO(v))
	}
	writeJSON(w, 200, out)
}
func (h *Handler) CreateBenefitPackage(c *gin.Context, _ adminapi.CreateBenefitPackageParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	var body adminapi.CreateBenefitPackageInput
	if err == nil {
		err = decodeBody(w, r, &body)
	}
	if err != nil {
		writeError(w, application.BadRequest(err.Error()))
		return
	}
	isPreset, enabled := false, true
	if body.IsPreset != nil {
		isPreset = *body.IsPreset
	}
	if body.Enabled != nil {
		enabled = *body.Enabled
	}
	name, project := "", "default"
	if body.Name != nil {
		name = *body.Name
	}
	if body.ProjectName != nil {
		project = *body.ProjectName
	}
	models := []string{}
	if body.ModelIds != nil {
		models = *body.ModelIds
	}
	var limit *int64
	if body.MaterialLimit != nil {
		v := int64(*body.MaterialLimit)
		limit = &v
	}
	value, err := h.Benefits.Create(r.Context(), a, application.CreateBenefitPackage{IsPreset: isPreset, Name: name, ProjectName: project, AccessKeyID: body.AccessKeyId, SecretAccessKey: body.SecretAccessKey, Enabled: enabled, ModelIDs: models, MaterialLimit: limit})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, benefitDTO(value))
}
func (h *Handler) UpdateBenefitPackage(c *gin.Context, id string, _ adminapi.UpdateBenefitPackageParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	raw := map[string]json.RawMessage{}
	if err == nil {
		err = decodeBody(w, r, &raw)
	}
	if err != nil {
		writeError(w, application.BadRequest(err.Error()))
		return
	}
	encoded, _ := json.Marshal(raw)
	var body adminapi.UpdateBenefitPackageInput
	if err = json.Unmarshal(encoded, &body); err != nil {
		writeError(w, application.BadRequest(err.Error()))
		return
	}
	var models *[]string
	if body.ModelIds != nil {
		models = body.ModelIds
	}
	var limit *int64
	if body.MaterialLimit != nil {
		v := int64(*body.MaterialLimit)
		limit = &v
	}
	_, limitSet := raw["material_limit"]
	value, err := h.Benefits.Update(r.Context(), a, id, application.UpdateBenefitPackage{ExpectedRevision: int64(body.ExpectedRevision), Name: body.Name, ProjectName: body.ProjectName, AccessKeyID: body.AccessKeyId, SecretAccessKey: body.SecretAccessKey, Enabled: body.Enabled, ModelIDs: models, MaterialLimit: limit, MaterialLimitSet: limitSet})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, benefitDTO(value))
}
func (h *Handler) DeleteBenefitPackage(c *gin.Context, id string, p adminapi.DeleteBenefitPackageParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	if err == nil {
		err = h.Benefits.Delete(r.Context(), a, id, int64(p.ExpectedRevision))
	}
	if err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(204)
}
func (h *Handler) ListBenefitPackageAssetGroupCleanups(c *gin.Context, _ adminapi.ListBenefitPackageAssetGroupCleanupsParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	values, err := h.Benefits.ListCleanups(r.Context(), a)
	if err != nil {
		writeError(w, err)
		return
	}
	out := make([]adminapi.AssetGroupCleanup, 0, len(values))
	for _, v := range values {
		out = append(out, cleanupDTO(v))
	}
	writeJSON(w, 200, out)
}
func (h *Handler) RetryBenefitPackageAssetGroupCleanup(c *gin.Context, id string, _ adminapi.RetryBenefitPackageAssetGroupCleanupParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	value, err := h.Benefits.RetryCleanup(r.Context(), a, id)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, cleanupDTO(value))
}
