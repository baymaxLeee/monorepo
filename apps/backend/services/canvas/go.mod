module github.com/example/monorepo/canvas

go 1.27.0

toolchain go1.27.4

replace github.com/example/monorepo/observability-go => ../../libs/observability-go

require (
	github.com/caarlos0/env/v11 v11.4.2
	github.com/example/monorepo/inner-api-go v0.0.0
	github.com/example/monorepo/observability-go v0.0.0
	github.com/go-chi/chi/v5 v5.5.0
	github.com/google/uuid v1.6.0
	github.com/jackc/pgx/v5 v5.13.0
	github.com/joho/godotenv v1.5.1
	github.com/modelcontextprotocol/go-sdk v1.8.0
	github.com/redis/go-redis/v9 v9.23.0
	github.com/santhosh-tekuri/jsonschema/v6 v6.0.3
	github.com/volcengine/volcengine-go-sdk v1.2.64
	github.com/xuri/excelize/v2 v2.11.1
	go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp v0.72.0
	golang.org/x/net v0.62.0
	golang.org/x/sync v0.25.0
	golang.org/x/text v0.44.0
	google.golang.org/grpc v1.85.0
	google.golang.org/protobuf v1.36.12
)

replace github.com/example/monorepo/inner-api-go => ../../libs/inner-api-go

require (
	github.com/cenkalti/backoff/v5 v5.0.3 // indirect
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/davecgh/go-spew v1.1.2-0.20180830191138-d8f796af33cc // indirect
	github.com/felixge/httpsnoop v1.1.0 // indirect
	github.com/go-logr/logr v1.4.4 // indirect
	github.com/go-logr/stdr v1.2.2 // indirect
	github.com/google/jsonschema-go v0.4.3 // indirect
	github.com/grpc-ecosystem/grpc-gateway/v2 v2.30.0 // indirect
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.3 // indirect
	github.com/jmespath/go-jmespath v0.4.0 // indirect
	github.com/klauspost/compress v1.13.5 // indirect
	github.com/kr/text v0.2.0 // indirect
	github.com/pmezard/go-difflib v1.0.1-0.20181226105442-5d4384ee4fb2 // indirect
	github.com/richardlehane/mscfb v1.0.9 // indirect
	github.com/richardlehane/msoleps v1.0.6 // indirect
	github.com/rogpeppe/go-internal v1.16.0 // indirect
	github.com/segmentio/asm v1.1.3 // indirect
	github.com/segmentio/encoding v0.5.4 // indirect
	github.com/tiendc/go-deepcopy v1.7.2 // indirect
	github.com/volcengine/volc-sdk-golang v1.0.23 // indirect
	github.com/xuri/efp v0.0.3-0.20260924042702-217b81952dec // indirect
	github.com/xuri/nfp v0.0.2-0.20250530014748-2ddeb826f9a9 // indirect
	github.com/yosida95/uritemplate/v3 v3.0.2 // indirect
	go.opentelemetry.io/auto/sdk v1.2.1 // indirect
	go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc v0.72.0 // indirect
	go.opentelemetry.io/otel v1.47.0 // indirect
	go.opentelemetry.io/otel/exporters/otlp/otlptrace v1.47.0 // indirect
	go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp v1.47.0 // indirect
	go.opentelemetry.io/otel/log v1.47.0 // indirect
	go.opentelemetry.io/otel/metric v1.47.0 // indirect
	go.opentelemetry.io/otel/sdk v1.47.0 // indirect
	go.opentelemetry.io/otel/trace v1.47.0 // indirect
	go.opentelemetry.io/proto/otlp v1.11.0 // indirect
	go.uber.org/atomic v1.12.0 // indirect
	golang.org/x/crypto v0.59.0 // indirect
	golang.org/x/image v0.48.0 // indirect
	golang.org/x/oauth2 v0.36.0 // indirect
	golang.org/x/sys v0.50.0 // indirect
	golang.org/x/time v0.15.0 // indirect
	google.golang.org/genproto/googleapis/api v0.0.0-20260928230214-8a89bd6388cc // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20260928230214-8a89bd6388cc // indirect
	gopkg.in/yaml.v2 v2.2.8 // indirect
)

// The legacy parent overlaps the split api/rpc modules selected by gateway.
exclude google.golang.org/genproto v0.0.0-20200526211855-cb27e3aa2013
