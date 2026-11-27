package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

func BodyLimit(maxBytes int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		r := c.Request
		if r.Body != nil {
			limit := maxBytes
			if r.Method == http.MethodPut && strings.HasPrefix(r.URL.Path, "/api/storage-server/upload-sessions/") && strings.HasSuffix(r.URL.Path, "/content") {
				limit = 5 << 30
			}
			r.Body = http.MaxBytesReader(c.Writer, r.Body, limit)
		}
		c.Next()
	}
}
