package router

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/example/monorepo/storage/internal/config"
	"github.com/example/monorepo/storage/internal/crud"
	"github.com/example/monorepo/storage/internal/schema"
	"github.com/example/monorepo/storage/internal/service"
	"github.com/go-chi/chi/v5"
)

type Router struct {
	store   *crud.Store
	cfg     config.Config
	objects *service.ObjectService
}

func New(store *crud.Store, cfg config.Config) http.Handler {
	rt := &Router{
		store:   store,
		cfg:     cfg,
		objects: service.NewObjectService(store, cfg),
	}
	r := chi.NewRouter()
	r.Get("/livez", rt.livez)
	r.Get("/readyz", rt.readyz)
	r.Get("/healthz", rt.readyz)

	r.Route("/internal", func(r chi.Router) {
		r.Use(rt.requireInternalToken)
		r.Put("/buckets/{bucket}/objects/*", rt.putObject)
		r.Get("/buckets/{bucket}/objects/*", rt.getObject)
		r.Head("/buckets/{bucket}/objects/*", rt.headObject)
		r.Delete("/buckets/{bucket}/objects/*", rt.deleteObject)
		r.Post("/objects", rt.postObject)
	})
	return r
}

func (rt *Router) livez(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (rt *Router) readyz(w http.ResponseWriter, r *http.Request) {
	if err := rt.store.Ping(r.Context()); err != nil {
		writeProblem(w, http.StatusServiceUnavailable, "dependency_unavailable", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (rt *Router) putObject(w http.ResponseWriter, r *http.Request) {
	bucket, key := routeBucketKey(r)
	resp, err := rt.objects.Put(r.Context(), service.PutInput{
		Bucket:             bucket,
		Key:                key,
		ContentType:        r.Header.Get("Content-Type"),
		ContentDisposition: r.Header.Get("Content-Disposition"),
		Metadata:           metadataFromHeaders(r.Header),
		OwnerUserID:        r.URL.Query().Get("user_id"),
		Body:               r.Body,
	})
	if err != nil {
		writeObjectError(w, err)
		return
	}
	writeObjectHeaders(w, resp)
	writeJSON(w, http.StatusCreated, resp)
}

func (rt *Router) postObject(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(rt.cfg.MaxObjectBytes); err != nil {
		writeProblem(w, http.StatusBadRequest, "invalid_multipart", "multipart form is required")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeProblem(w, http.StatusBadRequest, "missing_file", "multipart field 'file' is required")
		return
	}
	defer file.Close()

	bucket := r.FormValue("bucket")
	if bucket == "" {
		bucket = rt.cfg.DefaultBucketName
	}
	key := r.FormValue("key")
	if key == "" {
		key = service.SafeObjectKey(strings.Trim(r.FormValue("prefix"), "/"), header.Filename)
	}
	contentType := header.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	resp, err := rt.objects.Put(r.Context(), service.PutInput{
		Bucket:             bucket,
		Key:                key,
		ContentType:        contentType,
		ContentDisposition: contentDisposition(header.Filename),
		Metadata:           metadataFromHeaders(r.Header),
		OwnerUserID:        r.FormValue("user_id"),
		Body:               file,
	})
	if err != nil {
		writeObjectError(w, err)
		return
	}
	writeObjectHeaders(w, resp)
	writeJSON(w, http.StatusCreated, resp)
}

func (rt *Router) headObject(w http.ResponseWriter, r *http.Request) {
	bucket, key := routeBucketKey(r)
	resp, err := rt.objects.Head(r.Context(), bucket, key)
	if err != nil {
		writeObjectError(w, err)
		return
	}
	writeObjectMetadataHeaders(w, resp)
	w.WriteHeader(http.StatusOK)
}

func (rt *Router) getObject(w http.ResponseWriter, r *http.Request) {
	bucket, key := routeBucketKey(r)
	obj, path, err := rt.objects.Get(r.Context(), bucket, key)
	if err != nil {
		writeObjectError(w, err)
		return
	}
	file, err := os.Open(path)
	if err != nil {
		writeProblem(w, http.StatusNotFound, "object_file_missing", "object payload is missing")
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "object_stat_failed", "could not stat object")
		return
	}
	w.Header().Set("Content-Type", obj.ContentType)
	w.Header().Set("Content-Length", stringInt(obj.SizeBytes))
	w.Header().Set("ETag", obj.ETag)
	w.Header().Set("X-Object-Sha256", obj.SHA256)
	if obj.ContentDisposition != "" {
		w.Header().Set("Content-Disposition", obj.ContentDisposition)
	}
	http.ServeContent(w, r, filepath.Base(obj.ObjectKey), info.ModTime(), file)
}

func (rt *Router) deleteObject(w http.ResponseWriter, r *http.Request) {
	bucket, key := routeBucketKey(r)
	if err := rt.objects.Delete(r.Context(), bucket, key); err != nil {
		writeObjectError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func routeBucketKey(r *http.Request) (string, string) {
	return chi.URLParam(r, "bucket"), strings.TrimPrefix(chi.URLParam(r, "*"), "/")
}

func (rt *Router) requireInternalToken(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := r.Header.Get("X-Internal-Token")
		if subtle.ConstantTimeCompare([]byte(token), []byte(rt.cfg.InternalAPIToken)) != 1 {
			writeProblem(w, http.StatusUnauthorized, "invalid_internal_token", "internal token is invalid")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func metadataFromHeaders(headers http.Header) map[string]string {
	out := map[string]string{}
	for key, values := range headers {
		lower := strings.ToLower(key)
		if strings.HasPrefix(lower, "x-amz-meta-") {
			out[strings.TrimPrefix(lower, "x-amz-meta-")] = strings.Join(values, ",")
		}
		if strings.HasPrefix(lower, "x-object-meta-") {
			out[strings.TrimPrefix(lower, "x-object-meta-")] = strings.Join(values, ",")
		}
	}
	return out
}

func writeObjectHeaders(w http.ResponseWriter, resp schema.ObjectResponse) {
	w.Header().Set("ETag", resp.ETag)
	w.Header().Set("X-Object-Sha256", resp.SHA256)
	w.Header().Set("X-Object-Bucket", resp.Bucket)
	w.Header().Set("X-Object-Key", resp.Key)
	w.Header().Set("Content-Type", "application/json")
}

func writeObjectMetadataHeaders(w http.ResponseWriter, resp schema.ObjectResponse) {
	w.Header().Set("ETag", resp.ETag)
	w.Header().Set("X-Object-Sha256", resp.SHA256)
	w.Header().Set("X-Object-Bucket", resp.Bucket)
	w.Header().Set("X-Object-Key", resp.Key)
	w.Header().Set("Content-Type", resp.ContentType)
	w.Header().Set("Content-Length", stringInt(resp.Size))
}

func writeObjectError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, service.ErrInvalidObject):
		writeProblem(w, http.StatusBadRequest, "invalid_object", "bucket or object key is invalid")
	case errors.Is(err, service.ErrTooLarge):
		writeProblem(w, http.StatusRequestEntityTooLarge, "object_too_large", "object exceeds max size")
	case errors.Is(err, service.ErrNotFound):
		writeProblem(w, http.StatusNotFound, "object_not_found", "object not found")
	default:
		writeProblem(w, http.StatusInternalServerError, "storage_failed", "storage operation failed")
	}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeProblem(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, schema.Problem{Code: code, Message: message})
}

func contentDisposition(filename string) string {
	name := filepath.Base(filename)
	if name == "." || name == "/" || name == "" {
		return ""
	}
	return `attachment; filename="` + strings.ReplaceAll(name, `"`, "") + `"`
}

func stringInt(n int64) string {
	return strconv.FormatInt(n, 10)
}
