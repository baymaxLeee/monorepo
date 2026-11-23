package storageclient

import (
	"context"
	"net"
	"testing"
	"time"

	storagev1 "github.com/example/monorepo/inner-api-go/gen/storage/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type uploadSessionServer struct {
	storagev1.UnimplementedUploadSessionServiceServer
	t *testing.T
}

func (server *uploadSessionServer) CreateUploadSession(_ context.Context, request *storagev1.CreateUploadSessionRequest) (*storagev1.CreateUploadSessionResponse, error) {
	if request.GetIntentId() != "intent" {
		server.t.Fatalf("request = %#v", request)
	}
	return &storagev1.CreateUploadSessionResponse{Session: &storagev1.UploadSession{UploadSessionId: "019d0000-0000-7000-8000-000000000001", IntentId: "intent", State: storagev1.UploadSessionState_UPLOAD_SESSION_STATE_PENDING, Filename: "cover.png", MediaType: "image/png", SizeBytes: 128, ExpiresAt: timestamppb.New(time.Now().UTC().Add(time.Hour)), UploadUrl: "/api/storage-server/upload-sessions/session/content"}}, nil
}

func TestCreateUploadSessionUsesAssetIntentContract(t *testing.T) {
	t.Parallel()
	listener := bufconn.Listen(1 << 20)
	server := grpc.NewServer()
	storagev1.RegisterUploadSessionServiceServer(server, &uploadSessionServer{t: t})
	go func() { _ = server.Serve(listener) }()
	connection, err := grpc.NewClient("passthrough:///bufconn", grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return listener.Dial() }))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = connection.Close(); server.Stop(); _ = listener.Close() })

	client := New(connection)
	session, err := client.CreateUploadSession(context.Background(), CreateUploadSessionInput{Filename: "cover.png", MediaType: "image/png", IdempotencyKey: "intent", SizeBytes: 128})
	if err != nil {
		t.Fatalf("CreateUploadSession() error = %v", err)
	}
	if session.UploadSessionID != "019d0000-0000-7000-8000-000000000001" || session.IntentID != "intent" {
		t.Fatalf("session = %#v", session)
	}
}
