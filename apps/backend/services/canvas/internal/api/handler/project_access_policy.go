package http

import (
	"reflect"

	applicationprojectaccess "github.com/example/monorepo/canvas/internal/application/projectaccess"
)

const (
	projectManagementAdminExemption = "project-management-admin"
	projectMemberUseCaseExemption   = "project-member-use-case"
	projectUsageAdminExemption      = "project-usage-admin"
)

var projectIDRequestType = reflect.TypeOf((*projectIDRequest)(nil)).Elem()

type projectIDRequest interface {
	GetProjectID() string
}

type workspaceIDRequest interface {
	GetWorkspaceID() string
	IsSetWorkspaceID() bool
}

type projectAccessPolicy struct {
	access       applicationprojectaccess.Access
	exemptReason string
}

func projectAccessPolicies() map[string]projectAccessPolicy {
	policies := make(map[string]projectAccessPolicy, 75)
	add := func(access applicationprojectaccess.Access, actions ...string) {
		for _, action := range actions {
			policies[action] = projectAccessPolicy{access: access}
		}
	}
	exempt := func(reason string, actions ...string) {
		for _, action := range actions {
			policies[action] = projectAccessPolicy{exemptReason: reason}
		}
	}

	add(applicationprojectaccess.AccessRead,
		"BatchGetProjectCanvases",
		"ListProjectCanvases",
		"GetProjectCanvas",
		"ListCanvasNodeHistories",
		"ListCanvasNodeDraftSessions",
		"GetCanvasGraph",
		"BatchGetAssetReviews",
		"BatchGetCanvasNodeStates",
		"SearchCanvasNodeAssets",
		"GetCanvasNodeDrafts",
		"ListResources",
		"GetProjectResourceStats",
		"GetResource",
		"BatchGetResources",
		"ListResourceAssets",
		"BatchGetResourceAssetGenerationStates",
		"BatchListResourceAssets",
		"GetResourceAssetGeneration",
		"GetResourceAssetGenerationRun",
		"GetProjectCanvasVideoArchiveExport",
		"BatchGetProjectCanvasVideoArchiveExports",
		"ListProjectCanvasVideoArchiveExports",
	)
	add(applicationprojectaccess.AccessUpdate,
		"StartCanvasNodeAssetsMatch", "CancelCanvasNodeAssetsMatch",
		"CreateProjectCanvas",
		"UpdateProjectCanvas",
		"UpdateCanvasView",
		"DeleteProjectCanvas",
		"MaterializeCanvasStandaloneAssetReference",
		"MaterializeCanvasResourceAssetReference",
		"CreateCanvasAsset",
		"ConfirmCanvasNodeDrafts",
		"CancelCanvasNodeDrafts",
		"StartCanvasNodeGeneration",
		"StartCanvasGeneration",
		"SelectCanvasNodeHistory",
		"CancelCanvasNodeGeneration",
		"CreateCanvasNode",
		"CopyCanvasNode",
		"UpdateCanvasNode",
		"BatchUpdateCanvasNodePositions",
		"DeleteCanvasNode",
		"BatchDeleteCanvasNodes",
		"ConnectCanvasNodes",
		"DeleteCanvasEdge",
		"ReorderStoryboardNodes",
		"CreateCanvasNodes",
		"CreateResource",
		"CreateResourceFromAsset",
		"UpdateResource",
		"DeleteResource",
		"BatchDeleteResources",
		"CreateResourceAsset",
		"CreateGeneratedResourceAsset",
		"ReplaceUploadedResourceAsset",
		"UpdateResourceAsset",
		"SetPrimaryResourceAsset",
		"DeleteResourceAsset",
		"BatchDeleteResourceAssets",
		"UpdateResourceAssetGeneration",
		"StartResourceAssetGeneration",
		"CancelResourceAssetGeneration",
		"SubmitAssetReview",
		"BatchSubmitAssetReviews",
		"StartProjectCanvasVideoArchiveExport",
		"CancelProjectCanvasVideoArchiveExport",
	)
	exempt(projectManagementAdminExemption,
		"BatchGetProjects",
		"GetProject",
		"UpdateProject",
		"DeleteProject",
		"GrantProjectModels",
	)
	exempt(projectMemberUseCaseExemption,
		"BatchGetProjectsByMember",
		"GetProjectByMember",
		"UpdateProjectByMember",
	)
	exempt(projectUsageAdminExemption,
		"ListProjectModels",
		"DownloadProjectUsageXLSX",
	)
	return policies
}
