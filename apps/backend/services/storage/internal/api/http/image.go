package httpapi

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"io"
	"net/http"
	"strconv"

	"github.com/disintegration/imaging"
	"github.com/go-chi/chi/v5"
	_ "golang.org/x/image/webp"
)

// These bounds preserve the existing vision-input contract while originals stay streamed.
const maxImageBytes = 32 * 1024 * 1024
const maxImagePixels = 40_000_000

func imageVariant(source io.ReadSeeker, size int64, maxDim int) ([]byte, error) {
	if maxDim < 1 || maxDim > 4096 || size > maxImageBytes {
		return nil, fmt.Errorf("image exceeds variant bounds")
	}
	config, _, err := image.DecodeConfig(io.LimitReader(source, maxImageBytes))
	if err != nil {
		return nil, err
	}
	if config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > maxImagePixels {
		return nil, fmt.Errorf("image pixel count exceeds variant bounds")
	}
	if _, err = source.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	decoded, err := imaging.Decode(io.LimitReader(source, maxImageBytes), imaging.AutoOrientation(true))
	if err != nil {
		return nil, err
	}
	resized := imaging.Fit(decoded, maxDim, maxDim, imaging.Lanczos)
	flattened := image.NewRGBA(resized.Bounds())
	draw.Draw(flattened, flattened.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	draw.Draw(flattened, flattened.Bounds(), resized, resized.Bounds().Min, draw.Over)
	var output bytes.Buffer
	if err = jpeg.Encode(&output, flattened, &jpeg.Options{Quality: 82}); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
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
