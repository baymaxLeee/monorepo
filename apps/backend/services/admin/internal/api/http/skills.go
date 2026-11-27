package httpapi

import (
	"encoding/json"
	"net/http"

	adminapi "github.com/example/monorepo/admin/internal/api/generated/adminapi"
	"github.com/example/monorepo/admin/internal/application"
	"github.com/example/monorepo/admin/internal/domain"
	"github.com/gin-gonic/gin"
)

func skillSummary(value domain.Skill) adminapi.SkillSummary {
	var publishedAt *string
	if value.PublishedAt != nil {
		formatted := value.PublishedAt.UTC().Format(timeLayout)
		publishedAt = &formatted
	}
	return adminapi.SkillSummary{Id: value.ID, UserId: value.UserID, WorkspaceId: value.WorkspaceID, TenantId: value.TenantID, Username: value.Username, Name: value.Name, Description: value.Description, Status: adminapi.SkillSummaryStatus(value.Status), IsEnabled: value.IsEnabled, HasUnpublishedChanges: value.HasUnpublishedChanges(), PublishedAt: publishedAt, CreatedAt: value.CreatedAt.UTC().Format(timeLayout), UpdatedAt: value.UpdatedAt.UTC().Format(timeLayout)}
}

func skillDTO(value domain.Skill) adminapi.Skill {
	summary := skillSummary(value)
	return adminapi.Skill{Id: summary.Id, UserId: summary.UserId, WorkspaceId: summary.WorkspaceId, TenantId: summary.TenantId, Username: summary.Username, Name: summary.Name, Description: summary.Description, Status: adminapi.SkillStatus(value.Status), IsEnabled: summary.IsEnabled, HasUnpublishedChanges: summary.HasUnpublishedChanges, PublishedAt: summary.PublishedAt, CreatedAt: summary.CreatedAt, UpdatedAt: summary.UpdatedAt, WorkspaceSeq: value.WorkspaceSeq}
}

func nodeDTO(value application.SkillNodeTree) adminapi.SkillFileNode {
	node := value.Node
	var size *int
	if node.SizeBytes != nil {
		converted := int(*node.SizeBytes)
		size = &converted
	}
	storageKind := adminapi.SkillFileNodeStorageKind(node.StorageKind)
	result := adminapi.SkillFileNode{Id: node.ID, Name: node.Name, Type: adminapi.SkillFileNodeType(node.NodeType), ParentId: node.ParentID, MimeType: node.MimeType, StorageKind: &storageKind, AssetId: node.AssetID, RevisionId: node.RevisionID, SizeBytes: size, Sha256: node.SHA256, Etag: value.ETag}
	if node.NodeType == "file" && node.StorageKind == "inline" {
		result.Content = node.Content
	}
	if node.NodeType == "directory" {
		children := make([]adminapi.SkillFileNode, 0, len(value.Children))
		for _, child := range value.Children {
			children = append(children, nodeDTO(child))
		}
		result.Children = &children
	}
	return result
}

func mutationDTO(value application.SkillMutation) adminapi.SkillNodeMutationResult {
	return adminapi.SkillNodeMutationResult{WorkspaceSeq: value.WorkspaceSeq, NodeId: value.NodeID, Etag: value.ETag}
}

func validationDTO(value application.SkillValidation) adminapi.SkillValidationResult {
	issues := make([]adminapi.SkillValidationIssue, 0, len(value.Issues))
	for _, issue := range value.Issues {
		issues = append(issues, adminapi.SkillValidationIssue{Path: issue.Path, Message: issue.Message})
	}
	return adminapi.SkillValidationResult{Ok: value.OK, Issues: issues}
}

func decodeBody(w http.ResponseWriter, r *http.Request, target any) error {
	return json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20)).Decode(target)
}

func (h *Handler) ListSkills(c *gin.Context, _ adminapi.ListSkillsParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	values, err := h.Skills.List(r.Context(), a)
	if err != nil {
		writeError(w, err)
		return
	}
	result := make([]adminapi.SkillSummary, 0, len(values))
	for _, value := range values {
		result = append(result, skillSummary(value))
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) GetSkill(c *gin.Context, id string, _ adminapi.GetSkillParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	value, err := h.Skills.Get(r.Context(), a, id)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, skillDTO(value))
}

func (h *Handler) CreateSkill(c *gin.Context, _ adminapi.CreateSkillParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	var body adminapi.CreateSkillInput
	if err == nil {
		err = decodeBody(w, r, &body)
	}
	if err != nil {
		writeError(w, application.BadRequest(err.Error()))
		return
	}
	value, err := h.Skills.Create(r.Context(), a, body.Name, body.Description)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, skillDTO(value))
}

func (h *Handler) UpdateSkill(c *gin.Context, id string, _ adminapi.UpdateSkillParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	var body adminapi.UpdateSkillInput
	if err == nil {
		err = decodeBody(w, r, &body)
	}
	if err != nil {
		writeError(w, application.BadRequest(err.Error()))
		return
	}
	var status *string
	if body.Status != nil {
		value := string(*body.Status)
		status = &value
	}
	value, err := h.Skills.Update(r.Context(), a, id, body.IsEnabled, status)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, skillDTO(value))
}

func (h *Handler) GetSkillWorkspace(c *gin.Context, id string, _ adminapi.GetSkillWorkspaceParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	skill, tree, err := h.Skills.Workspace(r.Context(), a, id)
	if err != nil {
		writeError(w, err)
		return
	}
	result := make([]adminapi.SkillFileNode, 0, len(tree))
	for _, node := range tree {
		result = append(result, nodeDTO(node))
	}
	writeJSON(w, http.StatusOK, adminapi.SkillWorkspace{SkillId: id, WorkspaceSeq: skill.WorkspaceSeq, Tree: result})
}

func (h *Handler) GetSkillFile(c *gin.Context, skillID, nodeID string, _ adminapi.GetSkillFileParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	value, err := h.Skills.File(r.Context(), a, skillID, nodeID)
	if err != nil {
		writeError(w, err)
		return
	}
	node := value.Node
	var size *int
	if node.SizeBytes != nil {
		converted := int(*node.SizeBytes)
		size = &converted
	}
	content := node.Content
	if node.StorageKind != "inline" {
		content = nil
	}
	writeJSON(w, http.StatusOK, adminapi.SkillFileContent{Id: node.ID, StorageKind: adminapi.SkillFileContentStorageKind(node.StorageKind), MimeType: node.MimeType, Content: content, AssetId: node.AssetID, RevisionId: node.RevisionID, SizeBytes: size, Sha256: node.SHA256, Url: value.URL, Etag: value.ETag})
}

func (h *Handler) CreateSkillNode(c *gin.Context, skillID string, _ adminapi.CreateSkillNodeParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	var body adminapi.CreateSkillNodeInput
	if err == nil {
		err = decodeBody(w, r, &body)
	}
	if err != nil {
		writeError(w, application.BadRequest(err.Error()))
		return
	}
	value, err := h.Skills.CreateNode(r.Context(), a, skillID, domain.SkillNode{ID: body.Id, ParentID: body.ParentId, Name: body.Name, NodeType: string(body.Type), Content: body.Content})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, mutationDTO(value))
}

func (h *Handler) AttachSkillAsset(c *gin.Context, skillID string, _ adminapi.AttachSkillAssetParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	var body adminapi.AttachSkillAssetInput
	if err == nil {
		err = decodeBody(w, r, &body)
	}
	if err != nil {
		writeError(w, application.BadRequest(err.Error()))
		return
	}
	value, err := h.Skills.AttachAsset(r.Context(), a, skillID, body.Id, body.ClientRef, body.ParentId, body.Name, body.UploadSessionId)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, mutationDTO(value))
}

func (h *Handler) PrepareSkillUpload(c *gin.Context, skillID string, _ adminapi.PrepareSkillUploadParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	var body adminapi.PrepareSkillUploadInput
	if err == nil {
		err = decodeBody(w, r, &body)
	}
	if err != nil {
		writeError(w, application.BadRequest(err.Error()))
		return
	}
	value, err := h.Skills.PrepareUpload(r.Context(), a, skillID, application.CreateUploadSession{Filename: body.Filename, MediaType: body.MediaType, SizeBytes: int64(body.SizeBytes)}, string(body.Purpose), body.ClientRef)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, adminapi.SkillUploadPlan{UploadSessionId: value.UploadSessionID, IntentId: value.IntentID, State: adminapi.SkillUploadPlanState(value.State), UploadUrl: value.UploadURL, ExpiresAt: value.ExpiresAt.Format("2006-01-02T15:04:05.999999Z"), AssetId: value.AssetID, RevisionId: value.RevisionID})
}

func (h *Handler) ImportSkillArchive(c *gin.Context, skillID string, _ adminapi.ImportSkillArchiveParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	var body adminapi.ImportSkillArchiveInput
	if err == nil {
		err = decodeBody(w, r, &body)
	}
	if err != nil {
		writeError(w, application.BadRequest(err.Error()))
		return
	}
	value, err := h.Skills.ImportArchive(r.Context(), a, skillID, body.ClientRef, body.UploadSessionId, body.BaseWorkspaceSeq)
	if err != nil {
		writeError(w, err)
		return
	}
	tree := make([]adminapi.SkillFileNode, 0, len(value.Tree))
	for _, node := range value.Tree {
		tree = append(tree, nodeDTO(node))
	}
	writeJSON(w, http.StatusOK, adminapi.ImportSkillArchiveResponse{
		Skill: skillDTO(value.Skill), Workspace: adminapi.SkillWorkspace{SkillId: value.Skill.ID, WorkspaceSeq: value.Skill.WorkspaceSeq, Tree: tree},
		ImportedFiles: value.ImportedFiles, ImportedAssetFiles: value.ImportedAssetFiles,
	})
}

func (h *Handler) UpdateSkillFileContent(c *gin.Context, skillID, nodeID string, _ adminapi.UpdateSkillFileContentParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	var body adminapi.UpdateSkillFileContentInput
	if err == nil {
		err = decodeBody(w, r, &body)
	}
	if err != nil {
		writeError(w, application.BadRequest(err.Error()))
		return
	}
	value, err := h.Skills.UpdateContent(r.Context(), a, skillID, nodeID, body.BaseEtag, body.Content)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, mutationDTO(value))
}

func (h *Handler) RenameSkillNode(c *gin.Context, skillID, nodeID string, _ adminapi.RenameSkillNodeParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	var body adminapi.RenameSkillNodeInput
	if err == nil {
		err = decodeBody(w, r, &body)
	}
	if err != nil {
		writeError(w, application.BadRequest(err.Error()))
		return
	}
	value, err := h.Skills.RenameNode(r.Context(), a, skillID, nodeID, body.BaseEtag, body.Name)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, mutationDTO(value))
}

func (h *Handler) MoveSkillNode(c *gin.Context, skillID, nodeID string, _ adminapi.MoveSkillNodeParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	var body adminapi.MoveSkillNodeInput
	if err == nil {
		err = decodeBody(w, r, &body)
	}
	if err != nil {
		writeError(w, application.BadRequest(err.Error()))
		return
	}
	value, err := h.Skills.MoveNode(r.Context(), a, skillID, nodeID, body.BaseEtag, body.ParentId)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, mutationDTO(value))
}

func (h *Handler) DeleteSkillNode(c *gin.Context, skillID, nodeID string, params adminapi.DeleteSkillNodeParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	value, err := h.Skills.DeleteNode(r.Context(), a, skillID, nodeID, params.BaseEtag)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, mutationDTO(value))
}

func (h *Handler) ValidateSkill(c *gin.Context, skillID string, _ adminapi.ValidateSkillParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	value, err := h.Skills.Validate(r.Context(), a, skillID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, validationDTO(value))
}

func (h *Handler) PublishSkill(c *gin.Context, skillID string, _ adminapi.PublishSkillParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	var body adminapi.PublishSkillInput
	if err == nil {
		err = decodeBody(w, r, &body)
	}
	if err != nil {
		writeError(w, application.BadRequest(err.Error()))
		return
	}
	skill, validation, err := h.Skills.Publish(r.Context(), a, skillID, body.BaseWorkspaceSeq)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, adminapi.PublishSkillResponse{Skill: skillDTO(skill), Validation: validationDTO(validation)})
}

func (h *Handler) DeleteSkill(c *gin.Context, skillID string, _ adminapi.DeleteSkillParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	if err == nil {
		err = h.Skills.Delete(r.Context(), a, skillID)
	}
	if err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) BulkDeleteSkills(c *gin.Context, _ adminapi.BulkDeleteSkillsParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	var body adminapi.BulkDeleteSkillsInput
	if err == nil {
		err = decodeBody(w, r, &body)
	}
	if err != nil {
		writeError(w, application.BadRequest(err.Error()))
		return
	}
	deleted, err := h.Skills.BulkDelete(r.Context(), a, body.Ids)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, adminapi.BulkDeleteSkillsResponse{Deleted: int(deleted)})
}
