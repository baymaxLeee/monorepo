package runtime

import (
	"context"
	"fmt"
	"io"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
)

const callerMetadataKey = "x-caller-service"
const tokenMetadataKey = "x-internal-token"

type ClientOptions struct {
	Caller         string
	Token          string
	DefaultTimeout time.Duration
}

func DialContext(ctx context.Context, target string, options ClientOptions, extra ...grpc.DialOption) (*grpc.ClientConn, error) {
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("dial inner API %s: %w", target, err)
	}
	if target == "" {
		return nil, fmt.Errorf("inner API target is required")
	}
	if options.Caller == "" {
		return nil, fmt.Errorf("inner API caller is required")
	}
	if options.Token == "" {
		return nil, fmt.Errorf("inner API caller credential is required")
	}
	if options.DefaultTimeout <= 0 {
		options.DefaultTimeout = 10 * time.Second
	}
	dialOptions := []grpc.DialOption{
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithStatsHandler(otelgrpc.NewClientHandler()),
		grpc.WithChainUnaryInterceptor(clientUnaryInterceptor(options)),
		grpc.WithChainStreamInterceptor(clientStreamInterceptor(options)),
	}
	dialOptions = append(dialOptions, extra...)
	connection, err := grpc.NewClient(target, dialOptions...)
	if err != nil {
		return nil, fmt.Errorf("dial inner API %s: %w", target, err)
	}
	return connection, nil
}

func outgoingContext(ctx context.Context, options ClientOptions) (context.Context, context.CancelFunc) {
	cancel := func() {}
	if _, ok := ctx.Deadline(); !ok {
		ctx, cancel = context.WithTimeout(ctx, options.DefaultTimeout)
	}
	outgoing, _ := metadata.FromOutgoingContext(ctx)
	outgoing = outgoing.Copy()
	outgoing.Delete(callerMetadataKey)
	outgoing.Delete(tokenMetadataKey)
	outgoing.Set(callerMetadataKey, options.Caller)
	outgoing.Set(tokenMetadataKey, options.Token)
	return metadata.NewOutgoingContext(ctx, outgoing), cancel
}

func clientUnaryInterceptor(options ClientOptions) grpc.UnaryClientInterceptor {
	return func(ctx context.Context, method string, request, response any, connection *grpc.ClientConn, invoke grpc.UnaryInvoker, callOptions ...grpc.CallOption) error {
		outgoing, cancel := outgoingContext(ctx, options)
		defer cancel()
		return invoke(outgoing, method, request, response, connection, callOptions...)
	}
}

func clientStreamInterceptor(options ClientOptions) grpc.StreamClientInterceptor {
	return func(ctx context.Context, description *grpc.StreamDesc, connection *grpc.ClientConn, method string, streamer grpc.Streamer, callOptions ...grpc.CallOption) (grpc.ClientStream, error) {
		outgoing, cancel := outgoingContext(ctx, options)
		stream, err := streamer(outgoing, description, connection, method, callOptions...)
		if err != nil {
			cancel()
			return nil, err
		}
		return &cancellingClientStream{ClientStream: stream, cancel: cancel}, nil
	}
}

type cancellingClientStream struct {
	grpc.ClientStream
	cancel context.CancelFunc
}

func (stream *cancellingClientStream) CloseSend() error {
	return stream.ClientStream.CloseSend()
}

func (stream *cancellingClientStream) Header() (metadata.MD, error) {
	header, err := stream.ClientStream.Header()
	if err != nil {
		stream.cancel()
	}
	return header, err
}

func (stream *cancellingClientStream) SendMsg(message any) error {
	err := stream.ClientStream.SendMsg(message)
	if err != nil {
		stream.cancel()
	}
	return err
}

func (stream *cancellingClientStream) RecvMsg(message any) error {
	err := stream.ClientStream.RecvMsg(message)
	if err != nil {
		stream.cancel()
	}
	if err == io.EOF {
		return io.EOF
	}
	return err
}
