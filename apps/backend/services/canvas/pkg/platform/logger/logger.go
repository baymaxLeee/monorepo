package logger

import (
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

const maxDebugErrorLength = 4096

const truncatedErrorSuffix = "...(truncated)"

var diagnosticFieldKeys = [...]string{
	"upstream_service",
	"upstream_action",
	"upstream_request_id",
	"upstream_error_code",
	"upstream_error_message",
}

type diagnosticFieldsProvider interface {
	DiagnosticFields() map[string]string
}

var (
	urlWithQueryPattern    = regexp.MustCompile(`(?i)https?://[^\s"'<>]*\?[^\s"'<>]*`)
	urlUserInfoPattern     = regexp.MustCompile(`(?i)(https?://)[^/\s:@]+(?::[^@\s/]*)?@`)
	queryOnlyPattern       = regexp.MustCompile(`(^|\s)\?[^\s"'<>]*=[^\s"'<>]*`)
	sensitiveHeaderPattern = regexp.MustCompile(`(?im)\b(authorization|proxy-authorization|cookie|set-cookie|x-tos-security-token)\b(\s*[:=]\s*)[^\r\n]*`)
	secretValuePattern     = regexp.MustCompile(`(?i)\b(token|access[_-]?key|secret[_-]?key|api[_-]?key|client[_-]?secret|credential|password|signature|ak|sk)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)`)
	bodyPattern            = regexp.MustCompile(`(?is)(\b(?:response[\s_-]*body|request[\s_-]*body|body))(?:\s*[:=]\s*|\s+).*$`)
	jsonPayloadPattern     = regexp.MustCompile(`(?s)(\{.*\}|\[.*\])`)
)

type Config struct {
	Level       string
	Format      string
	Component   string
	Version     string
	Environment string
	Output      io.Writer
}

func New(cfg Config) (*zap.Logger, error) {
	var level zapcore.Level
	if err := level.Set(cfg.Level); err != nil {
		return nil, err
	}
	if cfg.Format != "json" && cfg.Format != "console" {
		return nil, errors.New("log format must be json or console")
	}

	output := cfg.Output
	if output == nil {
		output = os.Stdout
	}
	encoderConfig := zap.NewProductionEncoderConfig()
	encoderConfig.TimeKey = "timestamp"
	encoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder
	encoderConfig.EncodeDuration = zapcore.StringDurationEncoder

	var encoder zapcore.Encoder
	if cfg.Format == "console" {
		encoder = zapcore.NewConsoleEncoder(encoderConfig)
	} else {
		encoder = zapcore.NewJSONEncoder(encoderConfig)
	}
	core := zapcore.NewCore(encoder, panicSafeWriteSyncer{WriteSyncer: zapcore.AddSync(output)}, level)
	return zap.New(core).With(
		zap.String("component", cfg.Component),
		zap.String("version", cfg.Version),
		zap.String("env", cfg.Environment),
	), nil
}

type panicSafeWriteSyncer struct {
	zapcore.WriteSyncer
}

func (sink panicSafeWriteSyncer) Write(payload []byte) (written int, err error) {
	defer func() {
		if recover() != nil {
			written = len(payload)
			err = nil
		}
	}()
	return sink.WriteSyncer.Write(payload)
}

func (sink panicSafeWriteSyncer) Sync() (err error) {
	defer func() {
		if recover() != nil {
			err = nil
		}
	}()
	return sink.WriteSyncer.Sync()
}

// Error writes safe diagnostic fields at normal levels and includes the raw
// cause only when debug logging is enabled. Logging failures never participate
// in business control flow.
func Error(log *zap.Logger, message string, err error, fields ...zap.Field) {
	if log == nil {
		return
	}
	defer func() {
		if recovered := recover(); recovered != nil {
			return
		}
	}()
	if err != nil {
		fields = append(fields, zap.String("error_type", fmt.Sprintf("%T", err)))
		fields = append(fields, safeDiagnosticFields(err)...)
		if DebugEnabled(log) {
			fields = append(fields, zap.String("error", safeErrorText(err)))
		}
	}
	log.Error(message, fields...)
}

func safeDiagnosticFields(err error) (fields []zap.Field) {
	defer func() {
		if recover() != nil {
			fields = nil
		}
	}()
	var provider diagnosticFieldsProvider
	if !errors.As(err, &provider) {
		return nil
	}
	diagnostics := provider.DiagnosticFields()
	for _, key := range diagnosticFieldKeys {
		value := strings.TrimSpace(diagnostics[key])
		if value == "" {
			continue
		}
		value = redactSensitiveErrorText(value)
		if len(value) > maxDebugErrorLength {
			value = value[:maxDebugErrorLength-len(truncatedErrorSuffix)] + truncatedErrorSuffix
		}
		fields = append(fields, zap.String(key, value))
	}
	return fields
}

// DebugEnabled reports whether debug fields may be emitted. Custom logger
// cores are treated as disabled if inspecting them panics.
func DebugEnabled(log *zap.Logger) (enabled bool) {
	if log == nil {
		return false
	}
	defer func() {
		if recover() != nil {
			enabled = false
		}
	}()
	return log.Core().Enabled(zap.DebugLevel)
}

func safeErrorText(err error) (text string) {
	defer func() {
		if recover() != nil {
			text = "<error formatting panicked>"
		}
	}()
	text = redactSensitiveErrorText(err.Error())
	if len(text) > maxDebugErrorLength {
		text = text[:maxDebugErrorLength-len(truncatedErrorSuffix)] + truncatedErrorSuffix
	}
	return text
}

func redactSensitiveErrorText(text string) string {
	text = bodyPattern.ReplaceAllString(text, "${1}=<redacted>")
	text = jsonPayloadPattern.ReplaceAllString(text, "<redacted-json>")
	text = urlWithQueryPattern.ReplaceAllString(text, "<redacted-url>")
	text = urlUserInfoPattern.ReplaceAllString(text, "${1}<redacted>@")
	text = queryOnlyPattern.ReplaceAllString(text, "$1<redacted-query>")
	text = sensitiveHeaderPattern.ReplaceAllString(text, "$1$2<redacted>")
	return secretValuePattern.ReplaceAllString(text, "$1$2<redacted>")
}
