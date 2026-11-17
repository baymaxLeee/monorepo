package storage

import (
	"context"
	"errors"
	"fmt"
	"io"

	"github.com/example/monorepo/admin/internal/application"
	commonv1 "github.com/example/monorepo/inner-api-go/gen/common/v1"
	storagev1 "github.com/example/monorepo/inner-api-go/gen/storage/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type Client struct {
	upload   storagev1.UploadSessionServiceClient
	assets   storagev1.AssetServiceClient
	delivery storagev1.DeliveryServiceClient
}

func New(upload storagev1.UploadSessionServiceClient, assets storagev1.AssetServiceClient, delivery storagev1.DeliveryServiceClient) Client {
	return Client{upload: upload, assets: assets, delivery: delivery}
}

func (client Client) CreateUploadSession(ctx context.Context, input application.CreateUploadSession) (application.UploadSession, error) {
	response, err := client.upload.CreateUploadSession(ctx, &storagev1.CreateUploadSessionRequest{Actor: actor(input.UserID, input.TenantID, input.WorkspaceID), IntentId: input.IntentID, Filename: input.Filename, MediaType: input.MediaType, Category: input.Category, SizeBytes: input.SizeBytes})
	if err != nil {
		return application.UploadSession{}, translate(err)
	}
	return uploadSession(response.GetSession()), nil
}

func (client Client) GetUploadSession(ctx context.Context, tenantID, workspaceID, uploadSessionID string) (application.UploadSession, error) {
	response, err := client.upload.DescribeUploadSession(ctx, &storagev1.DescribeUploadSessionRequest{Actor: actor("", tenantID, workspaceID), UploadSessionId: uploadSessionID})
	if err != nil {
		return application.UploadSession{}, translate(err)
	}
	return uploadSession(response.GetSession()), nil
}

func (client Client) DescribeRevision(ctx context.Context, tenantID, workspaceID, assetID, revisionID string) (application.AssetRevision, error) {
	response, err := client.assets.DescribeRevision(ctx, &storagev1.DescribeRevisionRequest{Actor: actor("", tenantID, workspaceID), AssetId: assetID, RevisionId: revisionID})
	if err != nil {
		return application.AssetRevision{}, translate(err)
	}
	value := response.GetRevision()
	return application.AssetRevision{AssetID: value.GetAssetId(), RevisionID: value.GetRevisionId(), Category: value.GetCategory(), Filename: value.GetFilename(), MediaType: value.GetMediaType(), SizeBytes: value.GetSizeBytes(), SHA256: value.GetSha256(), CreatedBy: value.GetCreatedBy()}, nil
}

func (client Client) DeliveryURL(ctx context.Context, tenantID, workspaceID, assetID, revisionID string) (string, error) {
	response, err := client.delivery.MintCapabilities(ctx, &storagev1.MintCapabilitiesRequest{Items: []*storagev1.DeliveryCapabilityItem{{Actor: actor("", tenantID, workspaceID), AssetId: assetID, RevisionId: revisionID}}})
	if err != nil {
		return "", translate(err)
	}
	if len(response.GetItems()) != 1 {
		return "", errors.New("storage returned an invalid delivery capability response")
	}
	return response.GetItems()[0].GetUrl(), nil
}

func (client Client) DownloadRevision(ctx context.Context, tenantID, workspaceID string, revision application.AssetRevision, maxBytes int64) ([]byte, error) {
	if revision.SizeBytes < 0 || revision.SizeBytes > maxBytes {
		return nil, application.BadRequest("asset revision exceeds the configured byte limit")
	}
	stream, err := client.assets.ReadContent(ctx, &storagev1.ReadContentRequest{Actor: actor("", tenantID, workspaceID), AssetId: revision.AssetID, RevisionId: revision.RevisionID})
	if err != nil {
		return nil, translate(err)
	}
	result := make([]byte, 0, revision.SizeBytes)
	for {
		message, recvErr := stream.Recv()
		if errors.Is(recvErr, io.EOF) {
			break
		}
		if recvErr != nil {
			return nil, translate(recvErr)
		}
		chunk := message.GetValue().GetChunk()
		if int64(len(result)+len(chunk)) > maxBytes {
			return nil, application.BadRequest("asset revision exceeds the configured byte limit")
		}
		result = append(result, chunk...)
	}
	if int64(len(result)) != revision.SizeBytes {
		return nil, fmt.Errorf("storage content size mismatch")
	}
	return result, nil
}

func (client Client) UploadAsset(ctx context.Context, input application.UploadAsset) (application.AssetRevision, error) {
	stream, err := client.assets.Upload(ctx)
	if err != nil {
		return application.AssetRevision{}, translate(err)
	}
	if err = stream.Send(&storagev1.UploadRequest{Value: &storagev1.UploadRequest_Metadata{Metadata: &storagev1.UploadMetadata{Actor: actor(input.UserID, input.TenantID, input.WorkspaceID), Filename: input.Filename, MediaType: input.MediaType, Category: "skill", IdempotencyKey: input.IdempotencyKey}}}); err != nil {
		return application.AssetRevision{}, translate(err)
	}
	for offset := 0; offset < len(input.Content); offset += 64 * 1024 {
		end := min(offset+64*1024, len(input.Content))
		if err = stream.Send(&storagev1.UploadRequest{Value: &storagev1.UploadRequest_Chunk{Chunk: input.Content[offset:end]}}); err != nil {
			return application.AssetRevision{}, translate(err)
		}
	}
	response, err := stream.CloseAndRecv()
	if err != nil {
		return application.AssetRevision{}, translate(err)
	}
	value := response.GetResult()
	return application.AssetRevision{AssetID: value.GetAssetId(), RevisionID: value.GetRevisionId(), Category: "skill", Filename: value.GetFilename(), MediaType: value.GetMediaType(), SizeBytes: value.GetSizeBytes(), SHA256: value.GetSha256(), CreatedBy: input.UserID}, nil
}

func actor(userID, tenantID, workspaceID string) *commonv1.ActorContext {
	return &commonv1.ActorContext{UserId: userID, TenantId: tenantID, WorkspaceId: workspaceID}
}

func uploadSession(value *storagev1.UploadSession) application.UploadSession {
	if value == nil {
		return application.UploadSession{}
	}
	result := application.UploadSession{UploadSessionID: value.GetUploadSessionId(), IntentID: value.GetIntentId(), State: uploadState(value.GetState()), UserID: value.GetUserId(), Category: value.GetCategory(), Filename: value.GetFilename(), MediaType: value.GetMediaType(), SizeBytes: value.GetSizeBytes(), UploadURL: value.GetUploadUrl(), AssetID: value.AssetId, RevisionID: value.RevisionId}
	if value.ExpiresAt != nil {
		result.ExpiresAt = value.ExpiresAt.AsTime()
	}
	return result
}

func uploadState(value storagev1.UploadSessionState) string {
	switch value {
	case storagev1.UploadSessionState_UPLOAD_SESSION_STATE_PENDING:
		return "pending"
	case storagev1.UploadSessionState_UPLOAD_SESSION_STATE_UPLOADING:
		return "uploading"
	case storagev1.UploadSessionState_UPLOAD_SESSION_STATE_COMPLETED:
		return "completed"
	case storagev1.UploadSessionState_UPLOAD_SESSION_STATE_FAILED:
		return "failed"
	case storagev1.UploadSessionState_UPLOAD_SESSION_STATE_ABORTED:
		return "aborted"
	default:
		return ""
	}
}

func translate(err error) error {
	message := status.Convert(err).Message()
	switch status.Code(err) {
	case codes.InvalidArgument:
		return application.BadRequest(message)
	case codes.NotFound:
		return application.NotFound("%s", message)
	case codes.FailedPrecondition, codes.Aborted:
		return application.Conflict(message)
	case codes.PermissionDenied, codes.Unauthenticated:
		return application.Forbidden(message)
	default:
		return err
	}
}
