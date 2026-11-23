package application

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"mime"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/example/monorepo/admin/internal/domain"
	"github.com/google/uuid"
)

type SkillService struct {
	Repository           SkillRepository
	Assets               SkillAssetStore
	Errors               ErrorClassifier
	ArchiveMaxBytes      int64
	ArchiveExpandedBytes int64
	AttachmentMaxBytes   int64
}

type SkillNodeTree struct {
	Node     domain.SkillNode
	ETag     string
	Children []SkillNodeTree
}

type SkillFile struct {
	Node domain.SkillNode
	ETag string
	URL  *string
}

type SkillMutation struct {
	WorkspaceSeq int
	NodeID       string
	ETag         *string
}

type SkillValidationIssue struct{ Path, Message string }
type SkillValidation struct {
	OK     bool
	Issues []SkillValidationIssue
}
type InternalSkill struct {
	ID, Name, Description, Body string
	Files                       []string
}
type InternalSkillFile struct {
	Path string
	Node domain.PublishedSkillNode
	URL  *string
}

type SkillImportResult struct {
	Skill              domain.Skill
	Tree               []SkillNodeTree
	ImportedFiles      int
	ImportedAssetFiles int
}

func (s SkillService) List(ctx context.Context, actor Actor) ([]domain.Skill, error) {
	return s.Repository.ListSkills(ctx, actor.WorkspaceID, actor.TenantID)
}

func (s SkillService) Get(ctx context.Context, actor Actor, id string) (domain.Skill, error) {
	value, err := s.Repository.GetSkill(ctx, id, actor.WorkspaceID, actor.TenantID, false)
	if s.Errors.IsNotFound(err) {
		return domain.Skill{}, NotFound("skill %s not found", id)
	}
	return value, err
}

func (s SkillService) Create(ctx context.Context, actor Actor, name, description string) (domain.Skill, error) {
	if err := RequireWorkspaceAdmin(actor); err != nil {
		return domain.Skill{}, err
	}
	if !domain.ValidateSkillName(name) {
		return domain.Skill{}, BadRequest("name must use lowercase letters, digits and single hyphens")
	}
	var result domain.Skill
	err := s.Repository.Transaction(ctx, func(repo SkillRepository) error {
		if _, err := repo.GetSkillByName(ctx, name, actor.WorkspaceID, actor.TenantID); err == nil {
			return BadRequestf("a skill named '%s' already exists in this team", name)
		} else if !s.Errors.IsNotFound(err) {
			return err
		}
		now := time.Now().UTC()
		contentBytes, _ := json.Marshal(description)
		content := fmt.Sprintf("---\nname: %s\ndescription: %s\n---\n\n# %s\n\n## Instructions\n\nDescribe the reusable workflow here.\n", name, contentBytes, name)
		mimeType := "text/markdown"
		node := domain.SkillNode{ID: shortID(), SkillID: shortID(), Name: "SKILL.md", NodeType: "file", MimeType: &mimeType, Content: &content, StorageKind: "inline", CreatedAt: now, UpdatedAt: now}
		hash, err := domain.WorkspaceHash([]domain.SkillNode{node})
		if err != nil {
			return err
		}
		node.SkillID = strings.ReplaceAll(uuid.NewString(), "-", "")
		node.SkillID = node.SkillID[:12]
		result = domain.Skill{ID: node.SkillID, UserID: actor.UserID, WorkspaceID: actor.WorkspaceID, TenantID: actor.TenantID, Username: actor.Name, Name: name, Description: description, Status: "draft", IsEnabled: true, WorkspaceSeq: 1, WorkspaceSHA256: &hash, CreatedAt: now, UpdatedAt: now}
		if _, err := repo.CreateSkill(ctx, result); err != nil {
			return err
		}
		return repo.CreateSkillNode(ctx, node)
	})
	return result, err
}

func (s SkillService) Update(ctx context.Context, actor Actor, id string, enabled *bool, status *string) (domain.Skill, error) {
	if err := RequireWorkspaceAdmin(actor); err != nil {
		return domain.Skill{}, err
	}
	var result domain.Skill
	err := s.Repository.Transaction(ctx, func(repo SkillRepository) error {
		value, err := getSkill(ctx, repo, s.Errors, actor, id, true)
		if err != nil {
			return err
		}
		if enabled != nil {
			value.IsEnabled = *enabled
		}
		if status != nil {
			if *status != "draft" && *status != "archived" {
				return BadRequest("status must be draft or archived")
			}
			value.Status = *status
		}
		value.UpdatedAt = time.Now().UTC()
		result, err = repo.SaveSkill(ctx, value)
		return err
	})
	return result, err
}

func (s SkillService) Workspace(ctx context.Context, actor Actor, id string) (domain.Skill, []SkillNodeTree, error) {
	value, err := s.Get(ctx, actor, id)
	if err != nil {
		return domain.Skill{}, nil, err
	}
	nodes, err := s.Repository.ListSkillNodes(ctx, id)
	return value, buildSkillTree(nodes), err
}

func (s SkillService) File(ctx context.Context, actor Actor, skillID, nodeID string) (SkillFile, error) {
	_, err := s.Get(ctx, actor, skillID)
	if err != nil {
		return SkillFile{}, err
	}
	node, err := s.Repository.GetSkillNode(ctx, skillID, nodeID)
	if s.Errors.IsNotFound(err) || (err == nil && node.NodeType != "file") {
		return SkillFile{}, NotFound("skill file %s not found", nodeID)
	}
	if err != nil {
		return SkillFile{}, err
	}
	var delivery *string
	if node.StorageKind == "asset" && node.AssetID != nil && node.RevisionID != nil {
		value, err := s.Assets.DeliveryURL(ctx, *node.AssetID, *node.RevisionID)
		if err != nil {
			return SkillFile{}, err
		}
		delivery = &value
	}
	return SkillFile{Node: node, ETag: domain.NodeETag(node), URL: delivery}, nil
}

func (s SkillService) CreateNode(ctx context.Context, actor Actor, skillID string, node domain.SkillNode) (SkillMutation, error) {
	if err := RequireWorkspaceAdmin(actor); err != nil {
		return SkillMutation{}, err
	}
	if err := domain.ValidateNodeName(node.Name); err != nil {
		return SkillMutation{}, BadRequest(err.Error())
	}
	var result SkillMutation
	err := s.Repository.Transaction(ctx, func(repo SkillRepository) error {
		skill, err := getSkill(ctx, repo, s.Errors, actor, skillID, true)
		if err != nil {
			return err
		}
		if _, err := repo.GetSkillNode(ctx, skillID, node.ID); err == nil {
			return Conflictf("skill node %s already exists", node.ID)
		} else if !s.Errors.IsNotFound(err) {
			return err
		}
		if err := validateParentAndSibling(ctx, repo, s.Errors, skillID, node.ParentID, node.Name, ""); err != nil {
			return err
		}
		now := time.Now().UTC()
		node.SkillID, node.StorageKind, node.CreatedAt, node.UpdatedAt = skillID, "inline", now, now
		if node.NodeType == "directory" {
			node.Content, node.MimeType = nil, nil
		} else {
			if node.Content == nil {
				empty := ""
				node.Content = &empty
			}
			value := inlineMime(node.Name)
			node.MimeType = &value
		}
		if err := repo.CreateSkillNode(ctx, node); err != nil {
			return err
		}
		skill, err = finishSkillMutation(ctx, repo, s.Errors, actor, skill)
		if err != nil {
			return err
		}
		etag := domain.NodeETag(node)
		result = SkillMutation{WorkspaceSeq: skill.WorkspaceSeq, NodeID: node.ID, ETag: &etag}
		return nil
	})
	return result, err
}

func (s SkillService) PrepareUpload(ctx context.Context, actor Actor, skillID string, request CreateUploadSession, purpose, clientRef string) (UploadSession, error) {
	if err := RequireWorkspaceAdmin(actor); err != nil {
		return UploadSession{}, err
	}
	if _, err := s.Get(ctx, actor, skillID); err != nil {
		return UploadSession{}, err
	}
	limit := s.AttachmentMaxBytes
	if purpose == "skill-archive" {
		limit = s.ArchiveMaxBytes
		if request.MediaType != "application/zip" && request.MediaType != "application/x-zip-compressed" && request.MediaType != "application/octet-stream" {
			return UploadSession{}, BadRequest("skill import upload must be a ZIP archive")
		}
	}
	if limit > 0 && request.SizeBytes > limit {
		return UploadSession{}, BadRequestf("%s exceeds the configured byte limit", purpose)
	}
	request.IntentID = uploadIntentID(skillID, purpose, clientRef)
	return s.Assets.CreateUploadSession(ctx, request)
}

func (s SkillService) AttachAsset(ctx context.Context, actor Actor, skillID, nodeID, clientRef string, parentID *string, name, uploadSessionID string) (SkillMutation, error) {
	if err := RequireWorkspaceAdmin(actor); err != nil {
		return SkillMutation{}, err
	}
	revision, err := s.resolveUpload(ctx, actor, skillID, "skill-attachment", clientRef, uploadSessionID)
	if err != nil {
		return SkillMutation{}, err
	}
	if revision.Filename != name {
		return SkillMutation{}, BadRequest("skill attachment name does not match the authorized upload")
	}
	node := domain.SkillNode{ID: nodeID, ParentID: parentID, Name: name, NodeType: "file", StorageKind: "asset", MimeType: &revision.MediaType, AssetID: &revision.AssetID, RevisionID: &revision.RevisionID, SizeBytes: &revision.SizeBytes, SHA256: &revision.SHA256}
	var result SkillMutation
	err = s.Repository.Transaction(ctx, func(repo SkillRepository) error {
		skill, err := getSkill(ctx, repo, s.Errors, actor, skillID, true)
		if err != nil {
			return err
		}
		if _, err := repo.GetSkillNode(ctx, skillID, nodeID); err == nil {
			return Conflictf("skill node %s already exists", nodeID)
		} else if !s.Errors.IsNotFound(err) {
			return err
		}
		if err := validateParentAndSibling(ctx, repo, s.Errors, skillID, parentID, name, ""); err != nil {
			return err
		}
		if err := domain.ValidateNodeName(name); err != nil {
			return BadRequest(err.Error())
		}
		now := time.Now().UTC()
		node.SkillID, node.CreatedAt, node.UpdatedAt = skillID, now, now
		if err := repo.CreateSkillNode(ctx, node); err != nil {
			return err
		}
		if err := repo.UpsertAssetClaim(ctx, nodeClaim(skill, node, "skill_node", "active", "strong")); err != nil {
			return err
		}
		skill, err = finishSkillMutation(ctx, repo, s.Errors, actor, skill)
		if err != nil {
			return err
		}
		etag := domain.NodeETag(node)
		result = SkillMutation{WorkspaceSeq: skill.WorkspaceSeq, NodeID: node.ID, ETag: &etag}
		return nil
	})
	return result, err
}

func (s SkillService) ImportArchive(ctx context.Context, actor Actor, skillID, clientRef, uploadSessionID string, baseSeq int) (SkillImportResult, error) {
	if err := RequireWorkspaceAdmin(actor); err != nil {
		return SkillImportResult{}, err
	}
	revision, err := s.resolveUpload(ctx, actor, skillID, "skill-archive", clientRef, uploadSessionID)
	if err != nil {
		return SkillImportResult{}, err
	}
	if revision.MediaType != "application/zip" && revision.MediaType != "application/x-zip-compressed" && revision.MediaType != "application/octet-stream" {
		return SkillImportResult{}, BadRequest("skill import Asset must be a ZIP archive")
	}
	raw, err := s.Assets.DownloadRevision(ctx, revision, s.ArchiveMaxBytes)
	if err != nil {
		return SkillImportResult{}, err
	}
	files, err := extractSkillArchive(raw, s.AttachmentMaxBytes, s.ArchiveExpandedBytes)
	if err != nil {
		return SkillImportResult{}, err
	}
	binaries := map[string]AssetRevision{}
	for _, file := range files {
		if file.Inline {
			continue
		}
		digest := sha256.Sum256([]byte(revision.RevisionID + "\x00" + file.Path))
		uploaded, err := s.Assets.UploadAsset(ctx, UploadAsset{Filename: path.Base(file.Path), MediaType: file.MediaType, IdempotencyKey: "skill-archive:" + hex.EncodeToString(digest[:]), Content: file.Content})
		if err != nil {
			return SkillImportResult{}, err
		}
		binaries[file.Path] = uploaded
	}
	var result SkillImportResult
	err = s.Repository.Transaction(ctx, func(repo SkillRepository) error {
		skill, err := getSkill(ctx, repo, s.Errors, actor, skillID, true)
		if err != nil {
			return err
		}
		if skill.WorkspaceSeq != baseSeq {
			return Conflict("skill workspace changed in another session")
		}
		old, err := repo.ListSkillNodes(ctx, skillID)
		if err != nil {
			return err
		}
		for _, node := range old {
			if node.StorageKind == "asset" {
				if err := repo.UpsertAssetClaim(ctx, nodeClaim(skill, node, "skill_node", "released", "strong")); err != nil {
					return err
				}
			}
		}
		if err := repo.DeleteAllSkillNodes(ctx, skillID); err != nil {
			return err
		}
		now := time.Now().UTC()
		directories := map[string]string{}
		directorySet := map[string]bool{}
		for _, file := range files {
			for current := path.Dir(file.Path); current != "." && current != "/"; current = path.Dir(current) {
				directorySet[current] = true
			}
		}
		directoryNames := make([]string, 0, len(directorySet))
		for name := range directorySet {
			directoryNames = append(directoryNames, name)
		}
		sort.Slice(directoryNames, func(i, j int) bool {
			left, right := strings.Count(directoryNames[i], "/"), strings.Count(directoryNames[j], "/")
			if left == right {
				return directoryNames[i] < directoryNames[j]
			}
			return left < right
		})
		nodes := make([]domain.SkillNode, 0, len(files)+len(directoryNames))
		for _, directory := range directoryNames {
			var parentID *string
			if parent := path.Dir(directory); parent != "." {
				value := directories[parent]
				parentID = &value
			}
			node := domain.SkillNode{ID: shortID(), SkillID: skillID, ParentID: parentID, Name: path.Base(directory), NodeType: "directory", StorageKind: "inline", CreatedAt: now, UpdatedAt: now}
			directories[directory] = node.ID
			if err := repo.CreateSkillNode(ctx, node); err != nil {
				return err
			}
			nodes = append(nodes, node)
		}
		for _, file := range files {
			var parentID *string
			if parent := path.Dir(file.Path); parent != "." {
				value := directories[parent]
				parentID = &value
			}
			mediaType, size, checksum := file.MediaType, int64(len(file.Content)), file.SHA256
			node := domain.SkillNode{ID: shortID(), SkillID: skillID, ParentID: parentID, Name: path.Base(file.Path), NodeType: "file", MimeType: &mediaType, SizeBytes: &size, SHA256: &checksum, CreatedAt: now, UpdatedAt: now}
			if uploaded, ok := binaries[file.Path]; ok {
				node.StorageKind, node.AssetID, node.RevisionID, node.SizeBytes, node.SHA256 = "asset", &uploaded.AssetID, &uploaded.RevisionID, &uploaded.SizeBytes, &uploaded.SHA256
			} else {
				content := string(file.Content)
				node.StorageKind, node.Content = "inline", &content
			}
			if err := repo.CreateSkillNode(ctx, node); err != nil {
				return err
			}
			if node.StorageKind == "asset" {
				if err := repo.UpsertAssetClaim(ctx, nodeClaim(skill, node, "skill_node", "active", "strong")); err != nil {
					return err
				}
			}
			nodes = append(nodes, node)
		}
		if err := domain.ValidateWorkspace(nodes); err != nil {
			return BadRequest(err.Error())
		}
		if skill.SourceArchiveAssetID != nil && skill.SourceArchiveRevisionID != nil {
			if err := repo.UpsertAssetClaim(ctx, AssetClaim{TenantID: skill.TenantID, WorkspaceID: skill.WorkspaceID, OwnerType: "skill_import", OwnerID: skill.ID, Slot: "source-archive", AssetID: *skill.SourceArchiveAssetID, RevisionID: *skill.SourceArchiveRevisionID, Kind: "strong", DesiredState: "released"}); err != nil {
				return err
			}
		}
		if err := repo.UpsertAssetClaim(ctx, AssetClaim{TenantID: skill.TenantID, WorkspaceID: skill.WorkspaceID, OwnerType: "skill_import", OwnerID: skill.ID, Slot: "source-archive", AssetID: revision.AssetID, RevisionID: revision.RevisionID, Kind: "strong", DesiredState: "active"}); err != nil {
			return err
		}
		skill.SourceArchiveAssetID, skill.SourceArchiveRevisionID = &revision.AssetID, &revision.RevisionID
		skill, err = finishSkillMutation(ctx, repo, s.Errors, actor, skill)
		if err != nil {
			return err
		}
		result = SkillImportResult{Skill: skill, Tree: buildSkillTree(nodes), ImportedFiles: len(files), ImportedAssetFiles: len(binaries)}
		return nil
	})
	return result, err
}

func (s SkillService) UpdateContent(ctx context.Context, actor Actor, skillID, nodeID, baseETag, content string) (SkillMutation, error) {
	return s.mutateNode(ctx, actor, skillID, nodeID, baseETag, func(_ SkillRepository, node *domain.SkillNode) error {
		if node.NodeType != "file" {
			return BadRequest("only files have editable content")
		}
		if node.StorageKind != "inline" {
			return BadRequest("binary Asset files must be replaced with another immutable revision")
		}
		node.Content = &content
		return nil
	})
}

func (s SkillService) RenameNode(ctx context.Context, actor Actor, skillID, nodeID, baseETag, name string) (SkillMutation, error) {
	return s.mutateNode(ctx, actor, skillID, nodeID, baseETag, func(repo SkillRepository, node *domain.SkillNode) error {
		if isRootSkillMarkdown(*node) {
			return BadRequest("root SKILL.md cannot be renamed")
		}
		if err := domain.ValidateNodeName(name); err != nil {
			return BadRequest(err.Error())
		}
		if err := validateParentAndSibling(ctx, repo, s.Errors, skillID, node.ParentID, name, node.ID); err != nil {
			return err
		}
		node.Name = name
		if node.StorageKind == "inline" {
			value := inlineMime(name)
			node.MimeType = &value
		}
		return nil
	})
}

func (s SkillService) MoveNode(ctx context.Context, actor Actor, skillID, nodeID, baseETag string, parentID *string) (SkillMutation, error) {
	return s.mutateNode(ctx, actor, skillID, nodeID, baseETag, func(repo SkillRepository, node *domain.SkillNode) error {
		if isRootSkillMarkdown(*node) {
			return BadRequest("root SKILL.md cannot be moved")
		}
		if parentID != nil && *parentID == node.ID {
			return BadRequest("a node cannot be its own parent")
		}
		if err := validateParentAndSibling(ctx, repo, s.Errors, skillID, parentID, node.Name, node.ID); err != nil {
			return err
		}
		node.ParentID = parentID
		return nil
	})
}

func (s SkillService) mutateNode(ctx context.Context, actor Actor, skillID, nodeID, baseETag string, change func(SkillRepository, *domain.SkillNode) error) (SkillMutation, error) {
	if err := RequireWorkspaceAdmin(actor); err != nil {
		return SkillMutation{}, err
	}
	var result SkillMutation
	err := s.Repository.Transaction(ctx, func(repo SkillRepository) error {
		skill, err := getSkill(ctx, repo, s.Errors, actor, skillID, true)
		if err != nil {
			return err
		}
		node, err := repo.GetSkillNode(ctx, skillID, nodeID)
		if s.Errors.IsNotFound(err) {
			return NotFound("skill node %s not found", nodeID)
		}
		if err != nil {
			return err
		}
		current := domain.NodeETag(node)
		if current != baseETag {
			return NewError(409, "conflict", "skill node changed in another session").WithDetails(map[string]any{"expected": baseETag, "current": current})
		}
		if err := change(repo, &node); err != nil {
			return err
		}
		node.UpdatedAt = time.Now().UTC()
		if err := repo.SaveSkillNode(ctx, node); err != nil {
			return err
		}
		skill, err = finishSkillMutation(ctx, repo, s.Errors, actor, skill)
		if err != nil {
			return err
		}
		etag := domain.NodeETag(node)
		result = SkillMutation{WorkspaceSeq: skill.WorkspaceSeq, NodeID: node.ID, ETag: &etag}
		return nil
	})
	return result, err
}

func (s SkillService) DeleteNode(ctx context.Context, actor Actor, skillID, nodeID, baseETag string) (SkillMutation, error) {
	if err := RequireWorkspaceAdmin(actor); err != nil {
		return SkillMutation{}, err
	}
	var result SkillMutation
	err := s.Repository.Transaction(ctx, func(repo SkillRepository) error {
		skill, err := getSkill(ctx, repo, s.Errors, actor, skillID, true)
		if err != nil {
			return err
		}
		node, err := repo.GetSkillNode(ctx, skillID, nodeID)
		if s.Errors.IsNotFound(err) {
			return NotFound("skill node %s not found", nodeID)
		}
		if err != nil {
			return err
		}
		if domain.NodeETag(node) != baseETag {
			return Conflictf("skill node %s changed in another session", nodeID)
		}
		if isRootSkillMarkdown(node) {
			return BadRequest("root SKILL.md cannot be deleted")
		}
		nodes, err := repo.ListSkillNodes(ctx, skillID)
		if err != nil {
			return err
		}
		for _, candidate := range descendants(nodes, nodeID) {
			if candidate.StorageKind == "asset" {
				if err := repo.UpsertAssetClaim(ctx, nodeClaim(skill, candidate, "skill_node", "released", "strong")); err != nil {
					return err
				}
			}
		}
		if err := repo.DeleteSkillNode(ctx, skillID, nodeID); err != nil {
			return err
		}
		skill, err = finishSkillMutation(ctx, repo, s.Errors, actor, skill)
		if err != nil {
			return err
		}
		result = SkillMutation{WorkspaceSeq: skill.WorkspaceSeq, NodeID: nodeID}
		return nil
	})
	return result, err
}

func (s SkillService) Validate(ctx context.Context, actor Actor, skillID string) (SkillValidation, error) {
	if err := RequireWorkspaceAdmin(actor); err != nil {
		return SkillValidation{}, err
	}
	if _, err := s.Get(ctx, actor, skillID); err != nil {
		return SkillValidation{}, err
	}
	nodes, err := s.Repository.ListSkillNodes(ctx, skillID)
	if err != nil {
		return SkillValidation{}, err
	}
	return validateSkill(nodes), nil
}

func (s SkillService) Publish(ctx context.Context, actor Actor, skillID string, baseSeq int) (domain.Skill, SkillValidation, error) {
	if err := RequireWorkspaceAdmin(actor); err != nil {
		return domain.Skill{}, SkillValidation{}, err
	}
	var result domain.Skill
	var validation SkillValidation
	err := s.Repository.Transaction(ctx, func(repo SkillRepository) error {
		value, err := getSkill(ctx, repo, s.Errors, actor, skillID, true)
		if err != nil {
			return err
		}
		if value.WorkspaceSeq != baseSeq {
			return Conflict("skill workspace changed in another session")
		}
		nodes, err := repo.ListSkillNodes(ctx, skillID)
		if err != nil {
			return err
		}
		validation = validateSkill(nodes)
		if !validation.OK {
			return NewError(400, "invalid_request", "skill validation failed").WithDetails(map[string]any{"issues": validation.Issues})
		}
		old, err := repo.ListPublishedSkillNodes(ctx, skillID)
		if err != nil {
			return err
		}
		for _, node := range old {
			if node.StorageKind == "asset" && node.AssetID != nil && node.RevisionID != nil {
				if err := repo.UpsertAssetClaim(ctx, publishedNodeClaim(value, node, "released")); err != nil {
					return err
				}
			}
		}
		if err := repo.ReplacePublishedSkillNodes(ctx, skillID); err != nil {
			return err
		}
		for _, node := range nodes {
			if node.StorageKind == "asset" {
				if err := repo.UpsertAssetClaim(ctx, nodeClaim(value, node, "skill_published_node", "active", "snapshot")); err != nil {
					return err
				}
			}
		}
		now := time.Now().UTC()
		value.Status, value.PublishedSHA256, value.PublishedAt = "published", value.WorkspaceSHA256, &now
		value.PublishedName, value.PublishedDescription, value.UpdatedAt = &value.Name, &value.Description, now
		result, err = repo.SaveSkill(ctx, value)
		return err
	})
	return result, validation, err
}

func (s SkillService) Delete(ctx context.Context, actor Actor, skillID string) error {
	if err := RequireWorkspaceAdmin(actor); err != nil {
		return err
	}
	return s.Repository.Transaction(ctx, func(repo SkillRepository) error {
		value, err := getSkill(ctx, repo, s.Errors, actor, skillID, true)
		if err != nil {
			return err
		}
		if err := releaseSkillClaims(ctx, repo, value); err != nil {
			return err
		}
		return repo.DeleteSkill(ctx, skillID)
	})
}

func (s SkillService) BulkDelete(ctx context.Context, actor Actor, ids []string) (int64, error) {
	if err := RequireWorkspaceAdmin(actor); err != nil {
		return 0, err
	}
	var deleted int64
	err := s.Repository.Transaction(ctx, func(repo SkillRepository) error {
		values, err := repo.ListSkillsByIDs(ctx, ids, actor.WorkspaceID, actor.TenantID)
		if err != nil {
			return err
		}
		for _, value := range values {
			if err := releaseSkillClaims(ctx, repo, value); err != nil {
				return err
			}
		}
		deleted, err = repo.BulkDeleteSkills(ctx, ids, actor.WorkspaceID, actor.TenantID)
		return err
	})
	return deleted, err
}

func (s SkillService) Internal(ctx context.Context, skillID, workspaceID, tenantID string) (InternalSkill, error) {
	value, err := s.Repository.GetSkill(ctx, skillID, workspaceID, tenantID, false)
	if s.Errors.IsNotFound(err) || (err == nil && (value.Status != "published" || !value.IsEnabled)) {
		return InternalSkill{}, NotFound("published skill %s not found", skillID)
	}
	if err != nil {
		return InternalSkill{}, err
	}
	nodes, err := s.Repository.ListPublishedSkillNodes(ctx, skillID)
	if err != nil {
		return InternalSkill{}, err
	}
	paths, err := domain.PublishedPaths(nodes)
	if err != nil {
		return InternalSkill{}, err
	}
	var root *domain.PublishedSkillNode
	files := []string{}
	for i := range nodes {
		if nodes[i].ParentNodeID == nil && nodes[i].Name == "SKILL.md" && nodes[i].NodeType == "file" {
			root = &nodes[i]
		}
		if paths[nodes[i].NodeID] != "SKILL.md" {
			files = append(files, paths[nodes[i].NodeID])
		}
	}
	if root == nil {
		return InternalSkill{}, NotFound("published skill %s has no SKILL.md", skillID)
	}
	name, description, body, err := domain.ParseSkillMarkdown(stringPointer(root.Content))
	if err != nil {
		return InternalSkill{}, BadRequest(err.Error())
	}
	sort.Strings(files)
	return InternalSkill{ID: value.ID, Name: name, Description: description, Body: body, Files: files}, nil
}

func (s SkillService) InternalFile(ctx context.Context, skillID, workspaceID, tenantID, requestedPath string) (InternalSkillFile, error) {
	value, err := s.Repository.GetSkill(ctx, skillID, workspaceID, tenantID, false)
	if s.Errors.IsNotFound(err) || (err == nil && (value.Status != "published" || !value.IsEnabled)) {
		return InternalSkillFile{}, NotFound("published skill %s not found", skillID)
	}
	if err != nil {
		return InternalSkillFile{}, err
	}
	nodes, err := s.Repository.ListPublishedSkillNodes(ctx, skillID)
	if err != nil {
		return InternalSkillFile{}, err
	}
	paths, err := domain.PublishedPaths(nodes)
	if err != nil {
		return InternalSkillFile{}, err
	}
	for _, node := range nodes {
		if paths[node.NodeID] != requestedPath || node.NodeType != "file" {
			continue
		}
		var delivery *string
		if node.StorageKind == "asset" && node.AssetID != nil && node.RevisionID != nil {
			url, err := s.Assets.DeliveryURL(ctx, *node.AssetID, *node.RevisionID)
			if err != nil {
				return InternalSkillFile{}, err
			}
			delivery = &url
		}
		return InternalSkillFile{Path: requestedPath, Node: node, URL: delivery}, nil
	}
	return InternalSkillFile{}, NotFound("published skill file %s not found", requestedPath)
}

func (s SkillService) resolveUpload(ctx context.Context, actor Actor, skillID, purpose, clientRef, uploadSessionID string) (AssetRevision, error) {
	upload, err := s.Assets.GetUploadSession(ctx, uploadSessionID)
	if err != nil {
		return AssetRevision{}, err
	}
	if upload.IntentID != uploadIntentID(skillID, purpose, clientRef) {
		return AssetRevision{}, BadRequest("upload session does not belong to this Skill operation")
	}
	if upload.State != "completed" || upload.AssetID == nil || upload.RevisionID == nil {
		return AssetRevision{}, Conflict("upload session is not completed")
	}
	return s.Assets.DescribeRevision(ctx, *upload.AssetID, *upload.RevisionID)
}

func getSkill(ctx context.Context, repo SkillRepository, errors ErrorClassifier, actor Actor, id string, lock bool) (domain.Skill, error) {
	value, err := repo.GetSkill(ctx, id, actor.WorkspaceID, actor.TenantID, lock)
	if errors.IsNotFound(err) {
		return domain.Skill{}, NotFound("skill %s not found", id)
	}
	return value, err
}

func finishSkillMutation(ctx context.Context, repo SkillRepository, errors ErrorClassifier, actor Actor, skill domain.Skill) (domain.Skill, error) {
	nodes, err := repo.ListSkillNodes(ctx, skill.ID)
	if err != nil {
		return domain.Skill{}, err
	}
	if err := domain.ValidateWorkspace(nodes); err != nil {
		return domain.Skill{}, BadRequest(err.Error())
	}
	root, _ := domain.RootSkillMarkdown(nodes)
	if name, description, _, parseErr := domain.ParseSkillMarkdown(stringPointer(root.Content)); parseErr == nil {
		if name != skill.Name {
			existing, findErr := repo.GetSkillByName(ctx, name, actor.WorkspaceID, actor.TenantID)
			if findErr == nil && existing.ID != skill.ID {
				return domain.Skill{}, BadRequestf("a skill named '%s' already exists in this team", name)
			}
			if findErr != nil && !errors.IsNotFound(findErr) {
				return domain.Skill{}, findErr
			}
		}
		skill.Name, skill.Description = name, description
	}
	hash, err := domain.WorkspaceHash(nodes)
	if err != nil {
		return domain.Skill{}, BadRequest(err.Error())
	}
	skill.WorkspaceSeq++
	skill.WorkspaceSHA256, skill.UpdatedAt = &hash, time.Now().UTC()
	return repo.SaveSkill(ctx, skill)
}

func validateParentAndSibling(ctx context.Context, repo SkillRepository, errors ErrorClassifier, skillID string, parentID *string, name, excludingID string) error {
	if parentID != nil {
		parent, err := repo.GetSkillNode(ctx, skillID, *parentID)
		if errors.IsNotFound(err) {
			return NotFound("skill node %s not found", *parentID)
		}
		if err != nil {
			return err
		}
		if parent.NodeType != "directory" {
			return BadRequest("parent must be a directory")
		}
	}
	exists, err := repo.SiblingNameExists(ctx, skillID, parentID, name, excludingID)
	if err != nil {
		return err
	}
	if exists {
		return Conflictf("a node named '%s' already exists in this directory", name)
	}
	return nil
}

func validateSkill(nodes []domain.SkillNode) SkillValidation {
	if err := domain.ValidateWorkspace(nodes); err != nil {
		return SkillValidation{Issues: []SkillValidationIssue{{Path: "SKILL.md", Message: err.Error()}}}
	}
	root, _ := domain.RootSkillMarkdown(nodes)
	if _, _, _, err := domain.ParseSkillMarkdown(stringPointer(root.Content)); err != nil {
		return SkillValidation{Issues: []SkillValidationIssue{{Path: "SKILL.md", Message: err.Error()}}}
	}
	return SkillValidation{OK: true, Issues: []SkillValidationIssue{}}
}

func releaseSkillClaims(ctx context.Context, repo SkillRepository, skill domain.Skill) error {
	nodes, err := repo.ListSkillNodes(ctx, skill.ID)
	if err != nil {
		return err
	}
	for _, node := range nodes {
		if node.StorageKind == "asset" {
			if err := repo.UpsertAssetClaim(ctx, nodeClaim(skill, node, "skill_node", "released", "strong")); err != nil {
				return err
			}
		}
	}
	published, err := repo.ListPublishedSkillNodes(ctx, skill.ID)
	if err != nil {
		return err
	}
	for _, node := range published {
		if node.StorageKind == "asset" && node.AssetID != nil && node.RevisionID != nil {
			if err := repo.UpsertAssetClaim(ctx, publishedNodeClaim(skill, node, "released")); err != nil {
				return err
			}
		}
	}
	if skill.SourceArchiveAssetID != nil && skill.SourceArchiveRevisionID != nil {
		return repo.UpsertAssetClaim(ctx, AssetClaim{TenantID: skill.TenantID, WorkspaceID: skill.WorkspaceID, OwnerType: "skill_import", OwnerID: skill.ID, Slot: "source-archive", AssetID: *skill.SourceArchiveAssetID, RevisionID: *skill.SourceArchiveRevisionID, Kind: "strong", DesiredState: "released"})
	}
	return nil
}

func nodeClaim(skill domain.Skill, node domain.SkillNode, ownerType, state, kind string) AssetClaim {
	return AssetClaim{TenantID: skill.TenantID, WorkspaceID: skill.WorkspaceID, OwnerType: ownerType, OwnerID: skill.ID + ":" + node.ID, Slot: "content", AssetID: stringPointer(node.AssetID), RevisionID: stringPointer(node.RevisionID), Kind: kind, DesiredState: state}
}

func publishedNodeClaim(skill domain.Skill, node domain.PublishedSkillNode, state string) AssetClaim {
	return AssetClaim{TenantID: skill.TenantID, WorkspaceID: skill.WorkspaceID, OwnerType: "skill_published_node", OwnerID: skill.ID + ":" + node.NodeID, Slot: "content", AssetID: stringPointer(node.AssetID), RevisionID: stringPointer(node.RevisionID), Kind: "snapshot", DesiredState: state}
}

func uploadIntentID(skillID, purpose, clientRef string) string {
	hash := sha256.Sum256([]byte(skillID + "\x00" + purpose + "\x00" + clientRef))
	return purpose + ":" + hex.EncodeToString(hash[:])
}

func buildSkillTree(nodes []domain.SkillNode) []SkillNodeTree {
	children := map[string][]domain.SkillNode{}
	for _, node := range nodes {
		parent := ""
		if node.ParentID != nil {
			parent = *node.ParentID
		}
		children[parent] = append(children[parent], node)
	}
	var build func(domain.SkillNode) SkillNodeTree
	build = func(node domain.SkillNode) SkillNodeTree {
		result := SkillNodeTree{Node: node, ETag: domain.NodeETag(node)}
		for _, child := range children[node.ID] {
			result.Children = append(result.Children, build(child))
		}
		return result
	}
	result := []SkillNodeTree{}
	for _, node := range children[""] {
		result = append(result, build(node))
	}
	return result
}

func descendants(nodes []domain.SkillNode, root string) []domain.SkillNode {
	selected := map[string]bool{root: true}
	for changed := true; changed; {
		changed = false
		for _, node := range nodes {
			if node.ParentID != nil && selected[*node.ParentID] && !selected[node.ID] {
				selected[node.ID], changed = true, true
			}
		}
	}
	result := []domain.SkillNode{}
	for _, node := range nodes {
		if selected[node.ID] {
			result = append(result, node)
		}
	}
	return result
}

func inlineMime(name string) string {
	if value := mime.TypeByExtension(path.Ext(name)); value != "" {
		return strings.Split(value, ";")[0]
	}
	return "text/plain"
}

func isRootSkillMarkdown(node domain.SkillNode) bool {
	return node.ParentID == nil && node.Name == "SKILL.md"
}
func stringPointer(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
func shortID() string { return strings.ReplaceAll(uuid.NewString(), "-", "")[:12] }
