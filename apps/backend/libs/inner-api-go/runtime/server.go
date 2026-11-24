package runtime

import (
	"context"
	"crypto/subtle"
	"log/slog"
	"runtime/debug"

	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

const (
	workloadIdentityErrorDomain         = "inner-api.monorepo"
	workloadAuthenticationFailureReason = "CALLER_AUTHENTICATION_FAILED"
	workloadAuthorizationFailureReason  = "CALLER_AUTHORIZATION_FAILED"
)

type Authorizer interface {
	Authorize(caller, fullMethod string) bool
}

type Authenticator interface {
	Authenticate(caller, token string) bool
}

type TokenAuthenticator map[string]string

func (tokens TokenAuthenticator) Authenticate(caller, token string) bool {
	expected, ok := tokens[caller]
	return ok && expected != "" && subtle.ConstantTimeCompare([]byte(expected), []byte(token)) == 1
}

type AuthorizeFunc func(caller, fullMethod string) bool

func (authorize AuthorizeFunc) Authorize(caller, fullMethod string) bool {
	return authorize(caller, fullMethod)
}

type ServerOptions struct {
	Authenticator Authenticator
	Authorizer    Authorizer
	Logger        *slog.Logger
}

type verifiedCallerKey struct{}

func NewServer(options ServerOptions, extra ...grpc.ServerOption) *grpc.Server {
	if options.Logger == nil {
		options.Logger = slog.Default()
	}
	serverOptions := []grpc.ServerOption{
		grpc.StatsHandler(otelgrpc.NewServerHandler()),
		grpc.ChainUnaryInterceptor(recoverUnary(options.Logger), authenticateAuthorizeUnary(options.Authenticator, options.Authorizer, options.Logger)),
		grpc.ChainStreamInterceptor(recoverStream(options.Logger), authenticateAuthorizeStream(options.Authenticator, options.Authorizer, options.Logger)),
	}
	serverOptions = append(serverOptions, extra...)
	return grpc.NewServer(serverOptions...)
}

func CallerFromContext(ctx context.Context) string {
	caller, _ := ctx.Value(verifiedCallerKey{}).(string)
	return caller
}

// IsWorkloadIdentityError reports whether err was produced by the shared inner
// API workload authentication or authorization boundary. Application handlers
// may legitimately use the same gRPC status codes, so callers must not infer a
// transport credential failure from the code alone.
func IsWorkloadIdentityError(err error) bool {
	value, ok := status.FromError(err)
	if !ok {
		return false
	}
	for _, detail := range value.Details() {
		info, ok := detail.(*errdetails.ErrorInfo)
		if !ok || info.GetDomain() != workloadIdentityErrorDomain {
			continue
		}
		if info.GetReason() == workloadAuthenticationFailureReason || info.GetReason() == workloadAuthorizationFailureReason {
			return true
		}
	}
	return false
}

// WorkloadAuthenticationError constructs the shared error returned when an
// inner API cannot authenticate a calling workload.
func WorkloadAuthenticationError() error {
	return workloadIdentityError(codes.Unauthenticated, "caller authentication failed", workloadAuthenticationFailureReason)
}

// WorkloadAuthorizationError constructs the shared error returned when an
// authenticated workload is not authorized for an inner API method.
func WorkloadAuthorizationError() error {
	return workloadIdentityError(codes.PermissionDenied, "caller is not authorized for this RPC", workloadAuthorizationFailureReason)
}

func workloadIdentityError(code codes.Code, message, reason string) error {
	value := status.New(code, message)
	withDetails, err := value.WithDetails(&errdetails.ErrorInfo{
		Reason: reason,
		Domain: workloadIdentityErrorDomain,
	})
	if err != nil {
		return value.Err()
	}
	return withDetails.Err()
}

func credentialsFromContext(ctx context.Context) (string, string) {
	values, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return "", ""
	}
	callers := values.Get(callerMetadataKey)
	tokens := values.Get(tokenMetadataKey)
	if len(callers) != 1 || len(tokens) != 1 {
		return "", ""
	}
	return callers[0], tokens[0]
}

func authenticateAuthorizeUnary(authenticator Authenticator, authorizer Authorizer, logger *slog.Logger) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, request any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		caller, token := credentialsFromContext(ctx)
		if authenticator == nil || !authenticator.Authenticate(caller, token) {
			logger.WarnContext(ctx, "inner API caller authentication rejected", "caller", caller, "method", info.FullMethod)
			return nil, WorkloadAuthenticationError()
		}
		ctx = context.WithValue(ctx, verifiedCallerKey{}, caller)
		if authorizer == nil || !authorizer.Authorize(caller, info.FullMethod) {
			logger.WarnContext(ctx, "inner API caller authorization rejected", "caller", caller, "method", info.FullMethod)
			return nil, WorkloadAuthorizationError()
		}
		return handler(ctx, request)
	}
}

type authenticatedServerStream struct {
	grpc.ServerStream
	ctx context.Context
}

func (stream authenticatedServerStream) Context() context.Context { return stream.ctx }

func authenticateAuthorizeStream(authenticator Authenticator, authorizer Authorizer, logger *slog.Logger) grpc.StreamServerInterceptor {
	return func(service any, stream grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		caller, token := credentialsFromContext(stream.Context())
		if authenticator == nil || !authenticator.Authenticate(caller, token) {
			logger.WarnContext(stream.Context(), "inner API caller authentication rejected", "caller", caller, "method", info.FullMethod)
			return WorkloadAuthenticationError()
		}
		ctx := context.WithValue(stream.Context(), verifiedCallerKey{}, caller)
		if authorizer == nil || !authorizer.Authorize(caller, info.FullMethod) {
			logger.WarnContext(ctx, "inner API caller authorization rejected", "caller", caller, "method", info.FullMethod)
			return WorkloadAuthorizationError()
		}
		return handler(service, authenticatedServerStream{ServerStream: stream, ctx: ctx})
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
