package storageclient

import (
	"context"
	"errors"
	"io"
	"strings"
	"time"

	applicationassetclaim "github.com/example/monorepo/canvas/internal/application/assetclaim"
	applicationuploadintent "github.com/example/monorepo/canvas/internal/application/uploadintent"
	commonv1 "github.com/example/monorepo/inner-api-go/gen/common/v1"
	storagev1 "github.com/example/monorepo/inner-api-go/gen/storage/v1"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type RevisionRef struct {
	AssetID    string `json:"asset_id"`
	RevisionID string `json:"revision_id"`
}

func (ref RevisionRef) Valid() bool {
	return strings.TrimSpace(ref.AssetID) != "" && strings.TrimSpace(ref.RevisionID) != ""
}

type Revision struct {
	RevisionRef
	Category  string `json:"category"`
	Filename  string `json:"filename"`
	MediaType string `json:"media_type"`
	SizeBytes int64  `json:"size_bytes"`
	SHA256    string `json:"sha256"`
	CreatedBy string `json:"created_by"`
}

type UploadInput struct {
	TenantID, WorkspaceID, UserID string
	Filename, MediaType, Category string
	IdempotencyKey                string
	Body                          io.Reader
}

type CreateUploadSessionInput = applicationuploadintent.CreateUploadSessionInput
type UploadSession = applicationuploadintent.UploadSession

type DeliveryCapabilityInput struct {
	TenantID    string `json:"tenant_id"`
	WorkspaceID string `json:"workspace_id"`
	RevisionRef
}

type DeliveryCapability struct {
	RevisionRef
	URL       string    `json:"url"`
	ExpiresAt time.Time `json:"expires_at"`
}

type ClaimInput struct {
	TenantID, WorkspaceID string
	OwnerType, OwnerID    string
	Slot                  string
	RevisionRef
	Kind       string
	Generation int64
	ExpiresAt  *time.Time
}

type ClaimMutation struct {
	TenantID, WorkspaceID string
	OwnerType, OwnerID    string
	Slot                  string
	Generation            int64
}

type Client struct {
	assets   storagev1.AssetServiceClient
	claims   storagev1.ClaimServiceClient
	sessions storagev1.UploadSessionServiceClient
	delivery storagev1.DeliveryServiceClient
}

func New(connection grpc.ClientConnInterface) *Client {
	return &Client{
		assets: storagev1.NewAssetServiceClient(connection), claims: storagev1.NewClaimServiceClient(connection),
		sessions: storagev1.NewUploadSessionServiceClient(connection), delivery: storagev1.NewDeliveryServiceClient(connection),
	}
}

func actor(tenantID, workspaceID, userID string) *commonv1.ActorContext {
	return &commonv1.ActorContext{TenantId: tenantID, WorkspaceId: workspaceID, UserId: userID}
}

func (client *Client) Upload(ctx context.Context, input UploadInput) (Revision, error) {
	if strings.TrimSpace(input.TenantID) == "" || strings.TrimSpace(input.UserID) == "" || strings.TrimSpace(input.Filename) == "" || strings.TrimSpace(input.Category) == "" || strings.TrimSpace(input.IdempotencyKey) == "" || input.Body == nil {
		return Revision{}, errors.New("storage upload requires scope, user, filename, category, idempotency key, and body")
	}
	stream, err := client.assets.Upload(ctx)
	if err != nil {
		return Revision{}, err
	}
	metadata := &storagev1.UploadMetadata{Actor: actor(input.TenantID, input.WorkspaceID, input.UserID), Filename: input.Filename, MediaType: contentTypeOrDefault(input.MediaType), Category: input.Category, IdempotencyKey: input.IdempotencyKey}
	if err = stream.Send(&storagev1.UploadRequest{Value: &storagev1.UploadRequest_Metadata{Metadata: metadata}}); err != nil {
		return Revision{}, err
	}
	buffer := make([]byte, 256*1024)
	for {
		count, readErr := input.Body.Read(buffer)
		if count > 0 {
			chunk := append([]byte(nil), buffer[:count]...)
			if err = stream.Send(&storagev1.UploadRequest{Value: &storagev1.UploadRequest_Chunk{Chunk: chunk}}); err != nil {
				return Revision{}, err
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return Revision{}, readErr
		}
	}
	response, err := stream.CloseAndRecv()
	if err != nil {
		return Revision{}, err
	}
	result := response.GetResult()
	if result == nil {
		return Revision{}, errors.New("storage upload returned no revision")
	}
	value := Revision{RevisionRef: RevisionRef{AssetID: result.GetAssetId(), RevisionID: result.GetRevisionId()}, Category: input.Category, Filename: result.GetFilename(), MediaType: result.GetMediaType(), SizeBytes: result.GetSizeBytes(), SHA256: result.GetSha256(), CreatedBy: input.UserID}
	if !value.Valid() || value.SizeBytes < 0 || strings.TrimSpace(value.SHA256) == "" {
		return Revision{}, errors.New("storage upload returned invalid revision metadata")
	}
	return value, nil
}

func (client *Client) CreateUploadSession(ctx context.Context, input CreateUploadSessionInput) (UploadSession, error) {
	if strings.TrimSpace(input.TenantID) == "" || strings.TrimSpace(input.UserID) == "" || strings.TrimSpace(input.Filename) == "" || strings.TrimSpace(input.MediaType) == "" || strings.TrimSpace(input.Category) == "" || strings.TrimSpace(input.IdempotencyKey) == "" || input.SizeBytes < 0 {
		return UploadSession{}, errors.New("storage upload session requires scope, user, file metadata, category, and idempotency key")
	}
	response, err := client.sessions.CreateUploadSession(ctx, &storagev1.CreateUploadSessionRequest{Actor: actor(input.TenantID, input.WorkspaceID, input.UserID), IntentId: input.IdempotencyKey, Filename: input.Filename, MediaType: input.MediaType, Category: input.Category, SizeBytes: input.SizeBytes})
	if err != nil {
		return UploadSession{}, err
	}
	result := uploadSessionFromProto(response.GetSession())
	if err = validateUploadSession(result); err != nil {
		return UploadSession{}, err
	}
	return result, nil
}

func validateUploadSession(session UploadSession) error {
	if strings.TrimSpace(session.UploadSessionID) == "" || strings.TrimSpace(session.IntentID) == "" || strings.TrimSpace(session.State) == "" || strings.TrimSpace(session.UserID) == "" || strings.TrimSpace(session.Category) == "" || strings.TrimSpace(session.Filename) == "" || strings.TrimSpace(session.MediaType) == "" || strings.TrimSpace(session.UploadURL) == "" || session.SizeBytes < 0 || session.ExpiresAt.IsZero() {
		return errors.New("storage upload session response is invalid")
	}
	return nil
}

func (client *Client) Describe(ctx context.Context, tenantID, workspaceID string, ref RevisionRef) (Revision, error) {
	if strings.TrimSpace(tenantID) == "" || !ref.Valid() {
		return Revision{}, errors.New("storage describe requires scope and revision reference")
	}
	response, err := client.assets.DescribeRevision(ctx, &storagev1.DescribeRevisionRequest{Actor: actor(tenantID, workspaceID, ""), AssetId: ref.AssetID, RevisionId: ref.RevisionID})
	if err != nil {
		return Revision{}, err
	}
	result := revisionFromProto(response.GetRevision())
	if !result.Valid() || result.RevisionRef != ref {
		return Revision{}, errors.New("storage describe returned mismatched revision identity")
	}
	return result, nil
}

func (client *Client) Open(ctx context.Context, tenantID, workspaceID string, ref RevisionRef) (io.ReadCloser, error) {
	if strings.TrimSpace(tenantID) == "" || !ref.Valid() {
		return nil, errors.New("storage content read requires scope and revision reference")
	}
	stream, err := client.assets.ReadContent(ctx, &storagev1.ReadContentRequest{Actor: actor(tenantID, workspaceID, ""), AssetId: ref.AssetID, RevisionId: ref.RevisionID})
	if err != nil {
		return nil, err
	}
	reader, writer := io.Pipe()
	go func() {
		for {
			response, receiveErr := stream.Recv()
			if receiveErr == io.EOF {
				_ = writer.Close()
				return
			}
			if receiveErr != nil {
				_ = writer.CloseWithError(receiveErr)
				return
			}
			chunk := response.GetValue().GetChunk()
			if len(chunk) > 0 {
				if _, writeErr := writer.Write(chunk); writeErr != nil {
					return
				}
			}
		}
	}()
	return reader, nil
}

func (client *Client) MintDeliveryCapabilities(ctx context.Context, inputs []DeliveryCapabilityInput) ([]DeliveryCapability, error) {
	if len(inputs) == 0 || len(inputs) > 200 {
		return nil, errors.New("storage delivery capability batch must contain 1 to 200 items")
	}
	request := &storagev1.MintCapabilitiesRequest{Items: make([]*storagev1.DeliveryCapabilityItem, 0, len(inputs))}
	for _, input := range inputs {
		if strings.TrimSpace(input.TenantID) == "" || !input.Valid() {
			return nil, errors.New("storage delivery capability requires scope and revision reference")
		}
		request.Items = append(request.Items, &storagev1.DeliveryCapabilityItem{Actor: actor(input.TenantID, input.WorkspaceID, ""), AssetId: input.AssetID, RevisionId: input.RevisionID})
	}
	response, err := client.delivery.MintCapabilities(ctx, request)
	if err != nil {
		return nil, err
	}
	if len(response.GetItems()) != len(inputs) {
		return nil, errors.New("storage delivery capability response length mismatch")
	}
	result := make([]DeliveryCapability, 0, len(response.GetItems()))
	for _, item := range response.GetItems() {
		result = append(result, DeliveryCapability{RevisionRef: RevisionRef{AssetID: item.GetAssetId(), RevisionID: item.GetRevisionId()}, URL: item.GetUrl(), ExpiresAt: item.GetExpiresAt().AsTime()})
	}
	return result, nil
}

func (client *Client) PrepareClaim(ctx context.Context, input ClaimInput) error {
	if !input.Valid() {
		return errors.New("storage claim requires a revision reference")
	}
	request := &storagev1.PrepareClaimRequest{Actor: actor(input.TenantID, input.WorkspaceID, ""), OwnerType: input.OwnerType, OwnerId: input.OwnerID, Slot: input.Slot, Generation: input.Generation, AssetId: input.AssetID, RevisionId: &input.RevisionID, Kind: claimKind(input.Kind)}
	if input.ExpiresAt != nil {
		request.ExpiresAt = timestamppb.New(*input.ExpiresAt)
	}
	_, err := client.claims.PrepareClaim(ctx, request)
	return err
}

func (client *Client) ActivateClaim(ctx context.Context, input ClaimMutation) error {
	_, err := client.claims.ActivateClaim(ctx, &storagev1.ActivateClaimRequest{Actor: actor(input.TenantID, input.WorkspaceID, ""), OwnerType: input.OwnerType, OwnerId: input.OwnerID, Slot: input.Slot, Generation: input.Generation})
	return err
}

func (client *Client) ReleaseClaim(ctx context.Context, input ClaimMutation) error {
	_, err := client.claims.ReleaseClaim(ctx, &storagev1.ReleaseClaimRequest{Actor: actor(input.TenantID, input.WorkspaceID, ""), OwnerType: input.OwnerType, OwnerId: input.OwnerID, Slot: input.Slot, Generation: input.Generation})
	return err
}

func (client *Client) PrepareAssetClaim(ctx context.Context, intent applicationassetclaim.Intent) error {
	return client.PrepareClaim(ctx, ClaimInput{TenantID: intent.TenantID, WorkspaceID: intent.WorkspaceID, OwnerType: intent.OwnerType, OwnerID: intent.OwnerID, Slot: intent.Slot, RevisionRef: RevisionRef{AssetID: intent.AssetID, RevisionID: intent.RevisionID}, Kind: intent.Kind, Generation: intent.Generation, ExpiresAt: intent.ExpiresAt})
}

func (client *Client) ActivateAssetClaim(ctx context.Context, intent applicationassetclaim.Intent) error {
	return client.ActivateClaim(ctx, ClaimMutation{TenantID: intent.TenantID, WorkspaceID: intent.WorkspaceID, OwnerType: intent.OwnerType, OwnerID: intent.OwnerID, Slot: intent.Slot, Generation: intent.Generation})
}

func (client *Client) ReleaseAssetClaimIntent(ctx context.Context, intent applicationassetclaim.Intent) error {
	return client.ReleaseClaim(ctx, ClaimMutation{TenantID: intent.TenantID, WorkspaceID: intent.WorkspaceID, OwnerType: intent.OwnerType, OwnerID: intent.OwnerID, Slot: intent.Slot, Generation: intent.Generation})
}

func revisionFromProto(value *storagev1.RevisionMetadata) Revision {
	if value == nil {
		return Revision{}
	}
	return Revision{RevisionRef: RevisionRef{AssetID: value.GetAssetId(), RevisionID: value.GetRevisionId()}, Category: value.GetCategory(), Filename: value.GetFilename(), MediaType: value.GetMediaType(), SizeBytes: value.GetSizeBytes(), SHA256: value.GetSha256(), CreatedBy: value.GetCreatedBy()}
}

func uploadSessionFromProto(value *storagev1.UploadSession) UploadSession {
	if value == nil {
		return UploadSession{}
	}
	result := UploadSession{UploadSessionID: value.GetUploadSessionId(), IntentID: value.GetIntentId(), State: uploadSessionState(value.GetState()), UserID: value.GetUserId(), Category: value.GetCategory(), Filename: value.GetFilename(), MediaType: value.GetMediaType(), SizeBytes: value.GetSizeBytes(), UploadURL: value.GetUploadUrl(), AssetID: value.GetAssetId(), RevisionID: value.GetRevisionId()}
	if value.GetExpiresAt() != nil {
		result.ExpiresAt = value.GetExpiresAt().AsTime()
	}
	return result
}

func uploadSessionState(value storagev1.UploadSessionState) string {
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

func claimKind(value string) storagev1.ClaimKind {
	switch value {
	case "strong":
		return storagev1.ClaimKind_CLAIM_KIND_STRONG
	case "snapshot":
		return storagev1.ClaimKind_CLAIM_KIND_SNAPSHOT
	case "lease":
		return storagev1.ClaimKind_CLAIM_KIND_LEASE
	case "weak":
		return storagev1.ClaimKind_CLAIM_KIND_WEAK
	default:
		return storagev1.ClaimKind_CLAIM_KIND_UNSPECIFIED
	}
}

func contentTypeOrDefault(value string) string {
	if value = strings.TrimSpace(value); value != "" {
		return value
	}
	return "application/octet-stream"
}
