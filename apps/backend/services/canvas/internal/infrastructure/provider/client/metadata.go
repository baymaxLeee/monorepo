package providerclient

import (
	"net/http"
	"strings"
)

const HeaderProviderRequestID = "X-Request-Id"

func ProviderRequestID(header http.Header) string {
	return strings.TrimSpace(header.Get(HeaderProviderRequestID))
}
