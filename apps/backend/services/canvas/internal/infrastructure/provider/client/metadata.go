package aigwproxy

import (
	"net/http"
	"strings"
)

const HeaderAIGWRequestID = "X-Aigw-Request-Id"

func AIGWRequestID(header http.Header) string {
	return strings.TrimSpace(header.Get(HeaderAIGWRequestID))
}
