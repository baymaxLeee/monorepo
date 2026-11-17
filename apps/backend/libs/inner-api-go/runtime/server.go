package runtime

import (
	"context"
	"log/slog"
	"runtime/debug"

	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

type Authorizer interface {
	Authorize(caller, fullMethod string) bool
}

type AuthorizeFunc func(caller, fullMethod string) bool

func (authorize AuthorizeFunc) Authorize(caller, fullMethod string) bool {
	return authorize(caller, fullMethod)
}

type ServerOptions struct {
	Authorizer Authorizer
	Logger     *slog.Logger
}

func NewServer(options ServerOptions, extra ...grpc.ServerOption) *grpc.Server {
	if options.Logger == nil {
		options.Logger = slog.Default()
	}
	serverOptions := []grpc.ServerOption{
		grpc.StatsHandler(otelgrpc.NewServerHandler()),
		grpc.ChainUnaryInterceptor(recoverUnary(options.Logger), authorizeUnary(options.Authorizer)),
		grpc.ChainStreamInterceptor(recoverStream(options.Logger), authorizeStream(options.Authorizer)),
	}
	serverOptions = append(serverOptions, extra...)
	return grpc.NewServer(serverOptions...)
}

func CallerFromContext(ctx context.Context) string {
	values, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return ""
	}
	callers := values.Get(callerMetadataKey)
	if len(callers) != 1 {
		return ""
	}
	return callers[0]
}

func authorizeUnary(authorizer Authorizer) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, request any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		if authorizer != nil && !authorizer.Authorize(CallerFromContext(ctx), info.FullMethod) {
			return nil, status.Error(codes.PermissionDenied, "caller is not authorized for this RPC")
		}
		return handler(ctx, request)
	}
}

func authorizeStream(authorizer Authorizer) grpc.StreamServerInterceptor {
	return func(service any, stream grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		if authorizer != nil && !authorizer.Authorize(CallerFromContext(stream.Context()), info.FullMethod) {
			return status.Error(codes.PermissionDenied, "caller is not authorized for this RPC")
		}
		return handler(service, stream)
	}
}

func recoverUnary(logger *slog.Logger) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, request any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (response any, err error) {
		defer func() {
			if recovered := recover(); recovered != nil {
				logger.ErrorContext(ctx, "inner API panic", "method", info.FullMethod, "panic", recovered, "stack", string(debug.Stack()))
				response, err = nil, status.Error(codes.Internal, "internal server error")
			}
		}()
		return handler(ctx, request)
	}
}

func recoverStream(logger *slog.Logger) grpc.StreamServerInterceptor {
	return func(service any, stream grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) (err error) {
		defer func() {
			if recovered := recover(); recovered != nil {
				logger.ErrorContext(stream.Context(), "inner API stream panic", "method", info.FullMethod, "panic", recovered, "stack", string(debug.Stack()))
				err = status.Error(codes.Internal, "internal server error")
			}
		}()
		return handler(service, stream)
	}
}
