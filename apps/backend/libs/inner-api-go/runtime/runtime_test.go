package runtime

import (
	"context"
	"log/slog"
	"net"
	"testing"
	"time"

	commonv1 "github.com/example/monorepo/inner-api-go/gen/common/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/types/known/emptypb"
)

type testService interface {
	Call(context.Context, *commonv1.ActorContext) (*emptypb.Empty, error)
}

type testServer struct{}

func (testServer) Call(ctx context.Context, _ *commonv1.ActorContext) (*emptypb.Empty, error) {
	if _, ok := ctx.Deadline(); !ok {
		return nil, status.Error(codes.FailedPrecondition, "deadline is required")
	}
	return &emptypb.Empty{}, nil
}

func TestClientInjectsCallerAndDeadline(t *testing.T) {
	listener := bufconn.Listen(1024 * 1024)
	server := NewServer(ServerOptions{Authenticator: TokenAuthenticator{"runtime": "runtime-secret"}, Authorizer: AuthorizeFunc(func(caller, method string) bool {
		return caller == "runtime" && method == "/test.v1.Service/Call"
	})})
	serviceDescription := grpc.ServiceDesc{
		ServiceName: "test.v1.Service",
		HandlerType: (*testService)(nil),
		Methods: []grpc.MethodDesc{{MethodName: "Call", Handler: func(implementation any, ctx context.Context, decode func(any) error, interceptor grpc.UnaryServerInterceptor) (any, error) {
			request := &commonv1.ActorContext{}
			if err := decode(request); err != nil {
				return nil, err
			}
			if interceptor == nil {
				return implementation.(testService).Call(ctx, request)
			}
			info := &grpc.UnaryServerInfo{Server: implementation, FullMethod: "/test.v1.Service/Call"}
			handler := func(ctx context.Context, request any) (any, error) {
				return implementation.(testService).Call(ctx, request.(*commonv1.ActorContext))
			}
			return interceptor(ctx, request, info, handler)
		}}},
	}
	server.RegisterService(&serviceDescription, testServer{})
	go func() { _ = server.Serve(listener) }()
	defer server.Stop()

	connection, err := DialContext(context.Background(), "passthrough:///buffer", ClientOptions{Caller: "runtime", Token: "runtime-secret", DefaultTimeout: time.Second}, grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
		return listener.DialContext(ctx)
	}))
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	if err = connection.Invoke(context.Background(), "/test.v1.Service/Call", &commonv1.ActorContext{}, &emptypb.Empty{}); err != nil {
		t.Fatal(err)
	}
}

func TestServerRejectsUnknownCaller(t *testing.T) {
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(callerMetadataKey, "unknown", tokenMetadataKey, "secret"))
	_, err := authenticateAuthorizeUnary(TokenAuthenticator{"runtime": "runtime-secret"}, AuthorizeFunc(func(caller, _ string) bool { return caller == "runtime" }), slog.Default())(ctx, nil, &grpc.UnaryServerInfo{FullMethod: "/test.v1.Service/Call"}, func(context.Context, any) (any, error) { return nil, nil })
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("status = %v, want unauthenticated", status.Code(err))
	}
	if !IsWorkloadIdentityError(err) {
		t.Fatal("authentication rejection is missing the workload identity marker")
	}
}

func TestServerRejectsForbiddenMethodAfterAuthentication(t *testing.T) {
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(callerMetadataKey, "runtime", tokenMetadataKey, "runtime-secret"))
	_, err := authenticateAuthorizeUnary(TokenAuthenticator{"runtime": "runtime-secret"}, AuthorizeFunc(func(_ string, method string) bool { return method == "/allowed" }), slog.Default())(ctx, nil, &grpc.UnaryServerInfo{FullMethod: "/forbidden"}, func(context.Context, any) (any, error) { return nil, nil })
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("status = %v, want permission denied", status.Code(err))
	}
	if !IsWorkloadIdentityError(err) {
		t.Fatal("authorization rejection is missing the workload identity marker")
	}
}

func TestApplicationStatusIsNotAWorkloadIdentityError(t *testing.T) {
	for _, err := range []error{
		status.Error(codes.Unauthenticated, "application authentication failed"),
		status.Error(codes.PermissionDenied, "application permission denied"),
	} {
		if IsWorkloadIdentityError(err) {
			t.Fatalf("unmarked application status %v was classified as a workload identity error", status.Code(err))
		}
	}
}

func TestClientRequiresCredential(t *testing.T) {
	if _, err := DialContext(context.Background(), "localhost:1", ClientOptions{Caller: "runtime"}); err == nil {
		t.Fatal("missing caller credential was accepted")
	}
}
