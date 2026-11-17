package logger

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
)

const maxDebugErrorLength = 4096
const truncatedErrorSuffix = "...(truncated)"

var diagnosticFieldKeys = [...]string{
	"upstream_service", "upstream_action", "upstream_request_id",
	"upstream_error_code", "upstream_error_message",
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

// Error emits only redacted diagnostic fields at normal levels. The formatted
// cause is available exclusively when debug logging is enabled.
func Error(log *slog.Logger, message string, err error, fields ...slog.Attr) {
	if log == nil {
		return
	}
	if err != nil {
		fields = append(fields, slog.String("error_type", fmt.Sprintf("%T", err)))
		fields = append(fields, safeDiagnosticFields(err)...)
		if log.Enabled(context.Background(), slog.LevelDebug) {
			fields = append(fields, slog.String("error", safeErrorText(err)))
		}
	}
	log.LogAttrs(context.Background(), slog.LevelError, message, fields...)
}

func safeDiagnosticFields(err error) []slog.Attr {
	var provider diagnosticFieldsProvider
	if !errors.As(err, &provider) {
		return nil
	}
	diagnostics := provider.DiagnosticFields()
	fields := make([]slog.Attr, 0, len(diagnosticFieldKeys))
	for _, key := range diagnosticFieldKeys {
		value := strings.TrimSpace(diagnostics[key])
		if value == "" {
			continue
		}
		value = redactSensitiveErrorText(value)
		if len(value) > maxDebugErrorLength {
			value = value[:maxDebugErrorLength-len(truncatedErrorSuffix)] + truncatedErrorSuffix
		}
		fields = append(fields, slog.String(key, value))
	}
	return fields
}

func safeErrorText(err error) string {
	text := redactSensitiveErrorText(err.Error())
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
