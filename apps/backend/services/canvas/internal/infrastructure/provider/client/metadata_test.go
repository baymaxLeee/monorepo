package providerclient

import (
	"net/http"
	"testing"
)

func TestProviderRequestIDUsesStandardResponseHeader(t *testing.T) {
	header := make(http.Header)
	header.Set(HeaderProviderRequestID, " request-1 ")

	if got := ProviderRequestID(header); got != "request-1" {
		t.Fatalf("ProviderRequestID() = %q, want request-1", got)
	}
}
