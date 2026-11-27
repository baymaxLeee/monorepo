package httpserver

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"runtime/debug"
	"strings"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
	"go.opentelemetry.io/contrib/instrumentation/github.com/gin-gonic/gin/otelgin"
)

const (
	HeaderTraceParent = "traceparent"
)

var fallbackIDCounter atomic.Uint64

type traceIDContextKey struct{}
type originalPathContextKey struct{}

const routeColon = "~"

// Server preserves Gin's registration API while translating literal colons in
// Google-style action routes (for example, /uploads:prepare). Gin otherwise
// interprets every colon as the start of a path parameter.
type Server struct{ *gin.Engine }

func init() { gin.SetMode(gin.ReleaseMode) }

// New constructs the repository's standard Gin engine. Service-owned middleware
// and routes are registered by the caller after these cross-service invariants.
func New(serviceName string) *Server {
	engine := gin.New()
	engine.RedirectTrailingSlash = false
	engine.RedirectFixedPath = false
	engine.HandleMethodNotAllowed = true
	engine.Use(
		TraceContext(),
		otelgin.Middleware(serviceName, otelgin.WithFilter(func(request *http.Request) bool {
			return !isHealthPath(request.URL.Path)
		})),
		RequestLogger(),
		Recovery(),
	)
	return &Server{Engine: engine}
}

func (server *Server) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	originalPath := request.URL.Path
	request = request.Clone(context.WithValue(request.Context(), originalPathContextKey{}, originalPath))
	request.URL.Path = strings.ReplaceAll(originalPath, ":", routeColon)
	request.URL.RawPath = ""
	server.Engine.ServeHTTP(writer, request)
}

func (server *Server) GET(path string, handlers ...gin.HandlerFunc) gin.IRoutes {
	return server.Engine.GET(normalizeRoutePath(path), handlers...)
}
func (server *Server) HEAD(path string, handlers ...gin.HandlerFunc) gin.IRoutes {
	return server.Engine.HEAD(normalizeRoutePath(path), handlers...)
}
func (server *Server) POST(path string, handlers ...gin.HandlerFunc) gin.IRoutes {
	return server.Engine.POST(normalizeRoutePath(path), handlers...)
}
func (server *Server) PUT(path string, handlers ...gin.HandlerFunc) gin.IRoutes {
	return server.Engine.PUT(normalizeRoutePath(path), handlers...)
}
func (server *Server) PATCH(path string, handlers ...gin.HandlerFunc) gin.IRoutes {
	return server.Engine.PATCH(normalizeRoutePath(path), handlers...)
}
func (server *Server) DELETE(path string, handlers ...gin.HandlerFunc) gin.IRoutes {
	return server.Engine.DELETE(normalizeRoutePath(path), handlers...)
}
func (server *Server) OPTIONS(path string, handlers ...gin.HandlerFunc) gin.IRoutes {
	return server.Engine.OPTIONS(normalizeRoutePath(path), handlers...)
}

func normalizeRoutePath(path string) string {
	normalized := make([]byte, 0, len(path))
	for index := 0; index < len(path); index++ {
		if path[index] == ':' && index > 0 && path[index-1] != '/' {
			if path[index-1] == '\\' && len(normalized) > 0 {
				normalized = normalized[:len(normalized)-1]
			}
			normalized = append(normalized, routeColon...)
			continue
		}
		normalized = append(normalized, path[index])
	}
	return string(normalized)
}

// RoutePath prepares a route registered on a Gin RouterGroup when it contains
// a literal colon action. Server-level registrations are normalized automatically.
func RoutePath(path string) string { return normalizeRoutePath(path) }

// TrimAction extracts an identifier from an action-style path parameter after
// the server's literal-colon normalization.
func TrimAction(value, suffix string) (string, bool) {
	return strings.CutSuffix(value, strings.ReplaceAll(suffix, ":", routeColon))
}

func TraceID(ctx context.Context) string {
	traceID, _ := ctx.Value(traceIDContextKey{}).(string)
	return traceID
}

func TraceContext() gin.HandlerFunc {
	return func(c *gin.Context) {
		if path, ok := c.Request.Context().Value(originalPathContextKey{}).(string); ok {
			c.Request.URL.Path = path
		}
		traceParent := normalizeTraceParent(c.GetHeader(HeaderTraceParent))
		traceID := traceIDFromTraceParent(traceParent)
		if traceID == "" {
			traceID = newIdentifier(16)
		}
		if traceParent == "" {
			traceParent = "00-" + traceID + "-" + newIdentifier(8) + "-01"
		}

		c.Request.Header.Set(HeaderTraceParent, traceParent)
		c.Header(HeaderTraceParent, traceParent)
		ctx := context.WithValue(c.Request.Context(), traceIDContextKey{}, traceID)
		c.Request = c.Request.WithContext(ctx)
		c.Next()
	}
}

func RequestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		started := time.Now()
		c.Next()
		if isHealthPath(c.Request.URL.Path) {
			return
		}
		attributes := []any{
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"route", strings.ReplaceAll(c.FullPath(), routeColon, ":"),
			"status", c.Writer.Status(),
			"response_bytes", c.Writer.Size(),
			"duration_ms", time.Since(started).Milliseconds(),
		}
		if traceID := TraceID(c.Request.Context()); traceID != "" {
			attributes = append(attributes, "trace_id", traceID)
		}
		if userID := c.Request.Header.Get("X-Auth-User-ID"); userID != "" {
			attributes = append(attributes, "user_id", userID)
		}
		slog.InfoContext(c.Request.Context(), "http request", attributes...)
	}
}

func Recovery() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			recovered := recover()
			if recovered == nil {
				return
			}
			if recovered == http.ErrAbortHandler {
				c.Abort()
				return
			}
			slog.ErrorContext(c.Request.Context(), "http handler panicked",
				"panic", recovered,
				"path", c.Request.URL.Path,
				"trace_id", TraceID(c.Request.Context()),
				"stack", string(debug.Stack()),
			)
			c.Abort()
			if c.Writer.Written() {
				return
			}
			c.Header("Content-Type", "application/json")
			c.Status(http.StatusInternalServerError)
			_ = json.NewEncoder(c.Writer).Encode(map[string]string{
				"code": "internal_error", "message": "internal server error",
			})
		}()
		c.Next()
	}
}

func isHealthPath(path string) bool {
	switch path {
	case "/livez", "/readyz", "/healthz":
		return true
	default:
		return false
	}
}

func normalizeTraceParent(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	parts := strings.Split(value, "-")
	if len(parts) != 4 || parts[0] != "00" || len(parts[1]) != 32 || len(parts[2]) != 16 || len(parts[3]) != 2 {
		return ""
	}
	if parts[1] == strings.Repeat("0", 32) || parts[2] == strings.Repeat("0", 16) || !isHex(parts[1]+parts[2]+parts[3]) {
		return ""
	}
	return value
}

func traceIDFromTraceParent(value string) string {
	if value == "" {
		return ""
	}
	return strings.Split(value, "-")[1]
}

func newIdentifier(size int) string {
	value := make([]byte, size)
	if _, err := rand.Read(value); err == nil {
		return hex.EncodeToString(value)
	}
	fallback := sha256.Sum256([]byte(fmt.Sprintf("%d:%d", time.Now().UnixNano(), fallbackIDCounter.Add(1))))
	return hex.EncodeToString(fallback[:size])
}

func isHex(value string) bool {
	_, err := hex.DecodeString(value)
	return err == nil
}
