package rpcapi

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"time"

	storagev1 "github.com/example/monorepo/inner-api-go/gen/storage/v1"
	innerruntime "github.com/example/monorepo/inner-api-go/runtime"
	"github.com/example/monorepo/storage/internal/application"
	"github.com/example/monorepo/storage/internal/domain"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type Server struct {
	storagev1.UnimplementedAssetServiceServer
	storagev1.UnimplementedClaimServiceServer
	storagev1.UnimplementedUploadSessionServiceServer
	storagev1.UnimplementedDeliveryServiceServer
	service          *application.Service
	delivery         *application.DeliveryService
	uploadSessionURL func(application.UploadSession) string
}

func Register(server *grpc.Server, service *application.Service, delivery *application.DeliveryService, uploadSessionURL func(application.UploadSession) string) {
	adapter := &Server{service: service, delivery: delivery, uploadSessionURL: uploadSessionURL}
	storagev1.RegisterAssetServiceServer(server, adapter)
	storagev1.RegisterClaimServiceServer(server, adapter)
	storagev1.RegisterUploadSessionServiceServer(server, adapter)
	storagev1.RegisterDeliveryServiceServer(server, adapter)
}

func (s *Server) MintCapabilities(ctx context.Context, request *storagev1.MintCapabilitiesRequest) (*storagev1.MintCapabilitiesResponse, error) {
	if s.delivery == nil || len(request.GetItems()) == 0 || len(request.GetItems()) > 200 {
		return nil, status.Error(codes.InvalidArgument, "between 1 and 200 items are required")
	}
	result := make([]*storagev1.DeliveryCapability, 0, len(request.GetItems()))
	for _, item := range request.GetItems() {
		value, err := s.delivery.Mint(ctx, application.DeliveryItem{
			OwnerService: innerruntime.CallerFromContext(ctx), AssetID: item.GetAssetId(), RevisionID: item.GetRevisionId(),
			MaxDimension: int(item.GetMaxDimension()),
		})
		if err != nil {
			return nil, rpcError(err)
		}
		result = append(result, &storagev1.DeliveryCapability{AssetId: value.AssetID, RevisionId: value.RevisionID, Url: value.URL, ExpiresAt: timestamppb.New(value.ExpiresAt), Filename: value.Filename, MediaType: value.MediaType, SizeBytes: value.SizeBytes})
	}
	return &storagev1.MintCapabilitiesResponse{Items: result}, nil
}

func Authorizer() innerruntime.Authorizer {
	commonMethods := map[string]bool{
		storagev1.AssetService_Upload_FullMethodName:                        true,
		storagev1.AssetService_DescribeRevision_FullMethodName:              true,
		storagev1.AssetService_ReadContent_FullMethodName:                   true,
		storagev1.ClaimService_PrepareClaim_FullMethodName:                  true,
		storagev1.ClaimService_ActivateClaim_FullMethodName:                 true,
		storagev1.ClaimService_ReleaseClaim_FullMethodName:                  true,
		storagev1.UploadSessionService_CreateUploadSession_FullMethodName:   true,
		storagev1.UploadSessionService_DescribeUploadSession_FullMethodName: true,
		storagev1.DeliveryService_MintCapabilities_FullMethodName:           true,
	}
	runtimeMethods := map[string]bool{
		storagev1.AssetService_AppendRevision_FullMethodName:   true,
		storagev1.AssetService_ReadImageVariant_FullMethodName: true,
	}
	return innerruntime.AuthorizeFunc(func(caller string, method string) bool {
		if caller != "admin" && caller != "canvas" && caller != "knowledge" && caller != "runtime" {
			return false
		}
		return commonMethods[method] || caller == "runtime" && runtimeMethods[method]
	})
}

func (s *Server) Upload(stream storagev1.AssetService_UploadServer) error {
	first, err := stream.Recv()
	if err != nil {
		return rpcError(err)
	}
	metadata := first.GetMetadata()
	if metadata == nil {
		return status.Error(codes.InvalidArgument, "the first upload message must contain metadata")
	}
	asset, revision, err := s.service.Upload(stream.Context(), application.CreateUploadInput{
		Filename: metadata.GetFilename(), MediaType: metadata.GetMediaType(),
		CallerService: innerruntime.CallerFromContext(stream.Context()), IdempotencyKey: metadata.GetIdempotencyKey(),
	}, &uploadReader{recv: func() ([]byte, bool, error) {
		message, recvErr := stream.Recv()
		if recvErr != nil {
			return nil, false, recvErr
		}
		if message.GetMetadata() != nil {
			return nil, false, status.Error(codes.InvalidArgument, "upload metadata may only appear once")
		}
		return message.GetChunk(), true, nil
	}})
	if err != nil {
		return rpcError(err)
	}
	return stream.SendAndClose(&storagev1.UploadResponse{Result: uploadResult(asset.ID, revision)})
}

func (s *Server) AppendRevision(stream storagev1.AssetService_AppendRevisionServer) error {
	first, err := stream.Recv()
	if err != nil {
		return rpcError(err)
	}
	metadata := first.GetMetadata()
	if metadata == nil {
		return status.Error(codes.InvalidArgument, "the first append message must contain metadata")
	}
	asset, revision, err := s.service.AppendRevision(stream.Context(), application.AppendRevisionInput{
		Filename: metadata.GetFilename(), MediaType: metadata.GetMediaType(), CallerService: innerruntime.CallerFromContext(stream.Context()),
		IdempotencyKey: metadata.GetIdempotencyKey(), AssetID: metadata.GetAssetId(), BaseRevisionID: metadata.GetBaseRevisionId(),
		OwnerType: metadata.GetOwnerType(), OwnerID: metadata.GetOwnerId(), Slot: metadata.GetSlot(), Generation: metadata.GetGeneration(),
	}, &uploadReader{recv: func() ([]byte, bool, error) {
		message, recvErr := stream.Recv()
		if recvErr != nil {
			return nil, false, recvErr
		}
		if message.GetMetadata() != nil {
			return nil, false, status.Error(codes.InvalidArgument, "append metadata may only appear once")
		}
		return message.GetChunk(), true, nil
	}})
	if err != nil {
		return rpcError(err)
	}
	return stream.SendAndClose(&storagev1.AppendRevisionResponse{Result: uploadResult(asset.ID, revision)})
}

type uploadReader struct {
	recv      func() ([]byte, bool, error)
	remaining []byte
}

func (reader *uploadReader) Read(target []byte) (int, error) {
	for len(reader.remaining) == 0 {
		chunk, valid, err := reader.recv()
		if err != nil {
			if errors.Is(err, io.EOF) {
				return 0, io.EOF
			}
			return 0, err
		}
		if !valid {
			continue
		}
		reader.remaining = chunk
	}
	count := copy(target, reader.remaining)
	reader.remaining = reader.remaining[count:]
	return count, nil
}

func (s *Server) DescribeRevision(ctx context.Context, request *storagev1.DescribeRevisionRequest) (*storagev1.DescribeRevisionResponse, error) {
	if err := s.service.AuthorizeRevision(ctx, application.ClaimAuthorizationInput{
		OwnerService: innerruntime.CallerFromContext(ctx), AssetID: request.GetAssetId(), RevisionID: request.GetRevisionId(),
	}); err != nil {
		return nil, rpcError(err)
	}
	_, revision, err := s.service.Describe(ctx, request.GetAssetId(), request.GetRevisionId())
	if err != nil {
		return nil, rpcError(err)
	}
	return &storagev1.DescribeRevisionResponse{Revision: revisionMetadata(revision)}, nil
}

func (s *Server) ReadContent(request *storagev1.ReadContentRequest, stream storagev1.AssetService_ReadContentServer) error {
	if err := s.service.AuthorizeRevision(stream.Context(), application.ClaimAuthorizationInput{
		OwnerService: innerruntime.CallerFromContext(stream.Context()), AssetID: request.GetAssetId(), RevisionID: request.GetRevisionId(),
	}); err != nil {
		return rpcError(err)
	}
	revision, blob, err := s.service.Open(stream.Context(), request.GetAssetId(), request.GetRevisionId())
	if err != nil {
		return rpcError(err)
	}
	defer blob.Body.Close()
	offset := int64(0)
	if request.Offset != nil {
		offset = request.GetOffset()
	}
	if offset < 0 || offset > blob.Size {
		return status.Error(codes.InvalidArgument, "offset is outside content")
	}
	if _, err = blob.Body.Seek(offset, io.SeekStart); err != nil {
		return status.Error(codes.Internal, "seek content")
	}
	remaining := blob.Size - offset
	if request.Limit != nil {
		if request.GetLimit() < 0 {
			return status.Error(codes.InvalidArgument, "limit must not be negative")
		}
		remaining = min(remaining, request.GetLimit())
	}
	if err = stream.Send(&storagev1.ReadContentResponse{Value: &storagev1.ContentChunk{Value: &storagev1.ContentChunk_Metadata{Metadata: &storagev1.ContentMetadata{Filename: revision.Filename, MediaType: revision.MediaType, SizeBytes: remaining, Sha256: revision.SHA256}}}}); err != nil {
		return err
	}
	buffer := make([]byte, 64*1024)
	for remaining > 0 {
		count, readErr := blob.Body.Read(buffer[:min(int64(len(buffer)), remaining)])
		if count > 0 {
			chunk := append([]byte(nil), buffer[:count]...)
			if err = stream.Send(&storagev1.ReadContentResponse{Value: &storagev1.ContentChunk{Value: &storagev1.ContentChunk_Chunk{Chunk: chunk}}}); err != nil {
				return err
			}
			remaining -= int64(count)
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) && remaining == 0 {
				break
			}
			return status.Error(codes.Internal, "read content")
		}
	}
	return nil
}

func (s *Server) ReadImageVariant(request *storagev1.ReadImageVariantRequest, stream storagev1.AssetService_ReadImageVariantServer) error {
	if err := s.service.AuthorizeRevision(stream.Context(), application.ClaimAuthorizationInput{
		OwnerService: innerruntime.CallerFromContext(stream.Context()), AssetID: request.GetAssetId(), RevisionID: request.GetRevisionId(),
	}); err != nil {
		return rpcError(err)
	}
	_, blob, err := s.service.Open(stream.Context(), request.GetAssetId(), request.GetRevisionId())
	if err != nil {
		return rpcError(err)
	}
	defer blob.Body.Close()
	data, err := application.ImageVariant(blob.Body, blob.Size, int(request.GetMaxDimension()))
	if err != nil {
		return status.Error(codes.InvalidArgument, "image cannot be transformed within variant bounds")
	}
	variantSHA256 := fmt.Sprintf("%x", sha256.Sum256(data))
	if err = stream.Send(&storagev1.ReadImageVariantResponse{Value: &storagev1.ContentChunk{Value: &storagev1.ContentChunk_Metadata{Metadata: &storagev1.ContentMetadata{Filename: "preview.jpg", MediaType: "image/jpeg", SizeBytes: int64(len(data)), Sha256: variantSHA256}}}}); err != nil {
		return err
	}
	for offset := 0; offset < len(data); offset += 64 * 1024 {
		end := min(offset+64*1024, len(data))
		if err = stream.Send(&storagev1.ReadImageVariantResponse{Value: &storagev1.ContentChunk{Value: &storagev1.ContentChunk_Chunk{Chunk: data[offset:end]}}}); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) PrepareClaim(ctx context.Context, request *storagev1.PrepareClaimRequest) (*storagev1.PrepareClaimResponse, error) {
	var expiresAt *time.Time
	if request.ExpiresAt != nil {
		value := request.ExpiresAt.AsTime()
		expiresAt = &value
	}
	claim, err := s.service.PrepareClaim(ctx, application.PrepareClaimInput{OwnerService: innerruntime.CallerFromContext(ctx), OwnerType: request.GetOwnerType(), OwnerID: request.GetOwnerId(), Slot: request.GetSlot(), AssetID: request.GetAssetId(), RevisionID: request.GetRevisionId(), Kind: claimKind(request.GetKind()), Generation: request.GetGeneration(), ExpiresAt: expiresAt})
	if err != nil {
		return nil, rpcError(err)
	}
	return &storagev1.PrepareClaimResponse{Claim: claimMessage(claim)}, nil
}

func (s *Server) ActivateClaim(ctx context.Context, request *storagev1.ActivateClaimRequest) (*storagev1.ActivateClaimResponse, error) {
	claim, err := s.mutateClaim(ctx, request.GetOwnerType(), request.GetOwnerId(), request.GetSlot(), request.GetGeneration(), false)
	if err != nil {
		return nil, err
	}
	return &storagev1.ActivateClaimResponse{Claim: claimMessage(claim)}, nil
}

func (s *Server) ReleaseClaim(ctx context.Context, request *storagev1.ReleaseClaimRequest) (*storagev1.ReleaseClaimResponse, error) {
	claim, err := s.mutateClaim(ctx, request.GetOwnerType(), request.GetOwnerId(), request.GetSlot(), request.GetGeneration(), true)
	if err != nil {
		return nil, err
	}
	return &storagev1.ReleaseClaimResponse{Claim: claimMessage(claim)}, nil
}

func (s *Server) mutateClaim(ctx context.Context, ownerType, ownerID, slot string, generation int64, release bool) (domain.Claim, error) {
	input := application.ClaimMutationInput{OwnerService: innerruntime.CallerFromContext(ctx), OwnerType: ownerType, OwnerID: ownerID, Slot: slot, Generation: generation}
	var claim domain.Claim
	var err error
	if release {
		claim, err = s.service.ReleaseClaim(ctx, input)
	} else {
		claim, err = s.service.ActivateClaim(ctx, input)
	}
	return claim, rpcError(err)
}

func (s *Server) CreateUploadSession(ctx context.Context, request *storagev1.CreateUploadSessionRequest) (*storagev1.CreateUploadSessionResponse, error) {
	session, err := s.service.CreateUploadSession(ctx, application.CreateUploadSessionInput{CallerService: innerruntime.CallerFromContext(ctx), IdempotencyKey: request.GetIntentId(), Filename: request.GetFilename(), MediaType: request.GetMediaType(), SizeBytes: request.GetSizeBytes()})
	if err != nil {
		return nil, rpcError(err)
	}
	return &storagev1.CreateUploadSessionResponse{Session: s.uploadSession(session)}, nil
}

func (s *Server) DescribeUploadSession(ctx context.Context, request *storagev1.DescribeUploadSessionRequest) (*storagev1.DescribeUploadSessionResponse, error) {
	session, err := s.service.DescribeUploadSession(ctx, innerruntime.CallerFromContext(ctx), request.GetUploadSessionId())
	if err != nil {
		return nil, rpcError(err)
	}
	return &storagev1.DescribeUploadSessionResponse{Session: s.uploadSession(session)}, nil
}

func (s *Server) uploadSession(value application.UploadSession) *storagev1.UploadSession {
	result := &storagev1.UploadSession{UploadSessionId: value.ID, IntentId: value.IdempotencyKey, State: uploadSessionState(value.State), Filename: value.Filename, MediaType: value.MediaType, SizeBytes: value.SizeBytes, ExpiresAt: timestamppb.New(value.ExpiresAt), AssetId: optional(value.AssetID), RevisionId: optional(value.RevisionID)}
	if s.uploadSessionURL != nil {
		result.UploadUrl = s.uploadSessionURL(value)
	}
	return result
}

func uploadResult(assetID string, revision domain.Revision) *storagev1.UploadResult {
	return &storagev1.UploadResult{AssetId: assetID, RevisionId: revision.ID, Filename: revision.Filename, MediaType: revision.MediaType, SizeBytes: revision.SizeBytes, Sha256: revision.SHA256}
}
func revisionMetadata(revision domain.Revision) *storagev1.RevisionMetadata {
	return &storagev1.RevisionMetadata{AssetId: revision.AssetID, RevisionId: revision.ID, Filename: revision.Filename, MediaType: revision.MediaType, SizeBytes: revision.SizeBytes, Sha256: revision.SHA256}
}
func optional(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func claimKind(value storagev1.ClaimKind) domain.ClaimKind {
	switch value {
	case storagev1.ClaimKind_CLAIM_KIND_STRONG:
		return domain.ClaimStrong
	case storagev1.ClaimKind_CLAIM_KIND_SNAPSHOT:
		return domain.ClaimSnapshot
	case storagev1.ClaimKind_CLAIM_KIND_LEASE:
		return domain.ClaimLease
	case storagev1.ClaimKind_CLAIM_KIND_WEAK:
		return domain.ClaimWeak
	default:
		return ""
	}
}
func claimMessage(value domain.Claim) *storagev1.Claim {
	result := &storagev1.Claim{ClaimId: value.ID, AssetId: value.AssetID, RevisionId: value.RevisionID, Kind: mapClaimKind(value.Kind), Status: mapClaimStatus(value.Status), Generation: value.Generation}
	if value.ExpiresAt != nil {
		result.ExpiresAt = timestamppb.New(*value.ExpiresAt)
	}
	return result
}
func mapClaimKind(value domain.ClaimKind) storagev1.ClaimKind {
	switch value {
	case domain.ClaimStrong:
		return storagev1.ClaimKind_CLAIM_KIND_STRONG
	case domain.ClaimSnapshot:
		return storagev1.ClaimKind_CLAIM_KIND_SNAPSHOT
	case domain.ClaimLease:
		return storagev1.ClaimKind_CLAIM_KIND_LEASE
	case domain.ClaimWeak:
		return storagev1.ClaimKind_CLAIM_KIND_WEAK
	default:
		return storagev1.ClaimKind_CLAIM_KIND_UNSPECIFIED
	}
}
func mapClaimStatus(value string) storagev1.ClaimStatus {
	switch value {
	case "pending":
		return storagev1.ClaimStatus_CLAIM_STATUS_PENDING
	case "active":
		return storagev1.ClaimStatus_CLAIM_STATUS_ACTIVE
	case "released":
		return storagev1.ClaimStatus_CLAIM_STATUS_RELEASED
	default:
		return storagev1.ClaimStatus_CLAIM_STATUS_UNSPECIFIED
	}
}
func uploadSessionState(value string) storagev1.UploadSessionState {
	switch value {
	case "pending":
		return storagev1.UploadSessionState_UPLOAD_SESSION_STATE_PENDING
	case "uploading":
		return storagev1.UploadSessionState_UPLOAD_SESSION_STATE_UPLOADING
	case "completed":
		return storagev1.UploadSessionState_UPLOAD_SESSION_STATE_COMPLETED
	case "failed":
		return storagev1.UploadSessionState_UPLOAD_SESSION_STATE_FAILED
	case "aborted":
		return storagev1.UploadSessionState_UPLOAD_SESSION_STATE_ABORTED
	default:
		return storagev1.UploadSessionState_UPLOAD_SESSION_STATE_UNSPECIFIED
	}
}

func rpcError(err error) error {
	if err == nil {
		return nil
	}
	if status.Code(err) != codes.Unknown {
		return err
	}
	switch {
	case errors.Is(err, application.ErrInvalidInput):
		return status.Error(codes.InvalidArgument, err.Error())
	case errors.Is(err, application.ErrNotFound):
		return status.Error(codes.NotFound, err.Error())
	case errors.Is(err, application.ErrConflict):
		return status.Error(codes.FailedPrecondition, err.Error())
	default:
		return status.Error(codes.Internal, "storage operation failed")
	}
}
