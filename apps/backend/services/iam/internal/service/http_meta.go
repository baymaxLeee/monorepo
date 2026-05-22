package service

import (
	"net"
	"net/http"
	"strings"
)

func UserAgent(r *http.Request) string {
	ua := r.UserAgent()
	if len(ua) > 512 {
		return ua[:512]
	}
	return ua
}

func ClientIP(r *http.Request) string {
	for _, header := range []string{"X-Forwarded-For", "X-Real-IP"} {
		value := strings.TrimSpace(strings.Split(r.Header.Get(header), ",")[0])
		if value != "" {
			return value
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}
