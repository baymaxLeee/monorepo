package middleware

import (
	"log/slog"
	"os"
	"strings"
	"time"
)

// SetupLogging installs a process-wide slog JSON logger aligned with the
// cross-stack contract in schemas/observability/logging.md: lowercase level,
// millisecond UTC time with a trailing Z, and a static service field.
func SetupLogging(service string) {
	handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level:       parseLevel(os.Getenv("LOG_LEVEL")),
		ReplaceAttr: replaceAttr,
	})
	slog.SetDefault(slog.New(handler).With("service", service))
}

func parseLevel(raw string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

func replaceAttr(_ []string, a slog.Attr) slog.Attr {
	switch a.Key {
	case slog.LevelKey:
		if lvl, ok := a.Value.Any().(slog.Level); ok {
			a.Value = slog.StringValue(strings.ToLower(lvl.String()))
		}
	case slog.TimeKey:
		if t, ok := a.Value.Any().(time.Time); ok {
			a.Value = slog.StringValue(t.UTC().Format("2006-01-02T15:04:05.000Z07:00"))
		}
	}
	return a
}
