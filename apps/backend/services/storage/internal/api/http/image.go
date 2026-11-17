package httpapi

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/example/monorepo/storage/internal/application"
	"github.com/go-chi/chi/v5"
)

const maxImageBytes = application.MaxImageBytes

func imageVariant(source io.ReadSeeker, size int64, maxDim int) ([]byte, error) {
	return application.ImageVariant(source, size, maxDim)
}

func (router *Router) imageVariantRoute() http.HandlerFunc {
	return func(w http.ResponseWriter, request *http.Request) {
		maxDim, err := strconv.Atoi(request.URL.Query().Get("max_dim"))
		if err != nil || maxDim < 1 || maxDim > 4096 {
			writeProblem(w, 400, "invalid_request", "max_dim must be between 1 and 4096")
			return
		}
		query := request.URL.Query()
		revision, blob, err := router.service.Open(request.Context(), query.Get("tenant_id"), query.Get("workspace_id"), chi.URLParam(request, "assetID"), chi.URLParam(request, "revisionID"))
		if err != nil {
			writeServiceError(w, err)
			return
		}
		defer blob.Body.Close()
		data, err := imageVariant(blob.Body, blob.Size, maxDim)
		if err != nil {
			writeProblem(w, 400, "invalid_image", "image cannot be transformed within variant bounds")
			return
		}
		w.Header().Set("Content-Type", "image/jpeg")
		w.Header().Set("ETag", fmt.Sprintf("\"vision-v1:%s:%d\"", revision.SHA256, maxDim))
		w.Header().Set("Cache-Control", "private, no-cache")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		http.ServeContent(w, request, "preview.jpg", revision.CreatedAt, bytes.NewReader(data))
	}
}
