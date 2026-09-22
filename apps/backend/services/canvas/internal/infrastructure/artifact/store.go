package artifact

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	applicationimagegeneration "github.com/example/monorepo/canvas/internal/application/imagegeneration"
	applicationvideogeneration "github.com/example/monorepo/canvas/internal/application/videogeneration"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	"github.com/example/monorepo/canvas/internal/infrastructure/storage"
	"github.com/example/monorepo/canvas/internal/infrastructure/storage/namespace"
)

const (
	defaultContentType = "application/octet-stream"
	stagingNamespace   = "agentframe:blob-staging"
)

// Service is the artifact port used by the copied AgentFrame application
// layer. Knowledge replaces UP only behind this boundary.
type Service interface {
	applicationasset.ArtifactStore
	applicationvideogeneration.ReferenceResolver
	applicationimagegeneration.ReferenceResolver
	applicationvideogeneration.CanvasNodeVideoResultStore
	applicationimagegeneration.ImageResultStore
	ReferenceURL(context.Context, string, string, domainasset.Asset) (string, error)
	UploadBlob(context.Context, string, string, io.Reader) (string, int64, error)
}

type Store struct {
	client           *storage.Client
	publicGatewayURL string
}

func New(client *storage.Client, publicGatewayURL string) Service {
	return &Store{
		client:           client,
		publicGatewayURL: strings.TrimRight(publicGatewayURL, "/"),
	}
}

func knowledgeNamespace(namespace string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(namespace)))
	return hex.EncodeToString(digest[:])
}

func (s *Store) Inspect(ctx context.Context, _, _ string, blobID string) (applicationasset.DetectedBlob, error) {
	reader, err := s.client.Get(ctx, knowledgeNamespace(stagingNamespace), strings.TrimSpace(blobID))
	if err != nil {
		return applicationasset.DetectedBlob{}, fmt.Errorf("download staged blob: %w", err)
	}
	defer reader.Close()
	buffered := bufio.NewReader(reader)
	header, err := buffered.Peek(512)
	if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, bufio.ErrBufferFull) {
		return applicationasset.DetectedBlob{}, fmt.Errorf("inspect staged blob: %w", err)
	}
	contentType := http.DetectContentType(header)
	mediaType, ok := classifyContentType(contentType)
	if !ok {
		return applicationasset.DetectedBlob{}, applicationasset.ErrUnsupportedFormat
	}
	return applicationasset.DetectedBlob{MediaType: mediaType, ContentType: contentType}, nil
}

func (s *Store) UploadBlob(ctx context.Context, _, _ string, reader io.Reader) (string, int64, error) {
	stored, err := s.client.PutObject(ctx, knowledgeNamespace(stagingNamespace), reader)
	if err != nil {
		return "", 0, fmt.Errorf("upload staged blob: %w", err)
	}
	if strings.TrimSpace(stored.ArtifactID) == "" || stored.Size <= 0 {
		return "", 0, errors.New("upload staged blob returned an invalid result")
	}
	return stored.ArtifactID, stored.Size, nil
}

func (s *Store) Register(ctx context.Context, _, _ string, blobID, _ string, namespace string) (applicationasset.RegisteredArtifact, error) {
	reader, err := s.client.Get(ctx, knowledgeNamespace(stagingNamespace), strings.TrimSpace(blobID))
	if err != nil {
		return applicationasset.RegisteredArtifact{}, fmt.Errorf("open staged blob: %w", err)
	}
	defer reader.Close()
	stored, err := s.client.PutObject(ctx, knowledgeNamespace(namespace), reader)
	if err != nil {
		return applicationasset.RegisteredArtifact{}, fmt.Errorf("register artifact: %w", err)
	}
	return applicationasset.RegisteredArtifact{ArtifactID: stored.ArtifactID, ArtifactNamespace: namespace, SizeBytes: stored.Size}, nil
}

func (s *Store) RegisterMany(ctx context.Context, tenantID, callerID, namespace string, inputs []applicationasset.RegisterArtifactInput) []applicationasset.RegisterArtifactResult {
	results := make([]applicationasset.RegisterArtifactResult, len(inputs))
	for index, input := range inputs {
		results[index].Artifact, results[index].Err = s.Register(ctx, tenantID, callerID, input.BlobID, input.FileName, namespace)
	}
	return results
}

func (s *Store) Delete(ctx context.Context, artifactID, namespace string) error {
	if err := s.client.Delete(ctx, knowledgeNamespace(namespace), strings.TrimSpace(artifactID)); err != nil {
		return fmt.Errorf("delete artifact: %w", err)
	}
	return nil
}

func (s *Store) BatchPresignArtifacts(ctx context.Context, _, _ string, namespace string, artifactIDs []string) (map[string]applicationasset.PresignedArtifact, error) {
	resolvedNamespace := knowledgeNamespace(namespace)
	items := make([]storage.Artifact, 0, len(artifactIDs))
	for _, artifactID := range artifactIDs {
		if artifactID = strings.TrimSpace(artifactID); artifactID != "" {
			items = append(items, storage.Artifact{Namespace: resolvedNamespace, ID: artifactID, ContentType: defaultContentType})
		}
	}
	values, err := s.client.BatchPublicURLs(ctx, items)
	if err != nil {
		return nil, fmt.Errorf("batch presign artifacts: %w", err)
	}
	result := make(map[string]applicationasset.PresignedArtifact, len(values))
	for _, artifactID := range artifactIDs {
		artifactID = strings.TrimSpace(artifactID)
		value, ok := values[storage.ArtifactLookupKey(resolvedNamespace, artifactID)]
		if !ok {
			continue
		}
		expiresAt, parseErr := time.Parse(time.RFC3339, value.ExpiresAt)
		if parseErr != nil {
			return nil, fmt.Errorf("parse artifact expiry: %w", parseErr)
		}
		result[artifactID] = applicationasset.PresignedArtifact{URL: s.absoluteURL(value.URL), ExpiresAt: expiresAt}
	}
	return result, nil
}

func (s *Store) ReferenceURL(ctx context.Context, tenantID, callerID string, asset domainasset.Asset) (string, error) {
	return s.referenceURL(ctx, tenantID, callerID, asset)
}

func (s *Store) PublicReferenceURL(ctx context.Context, tenantID, callerID string, asset domainasset.Asset) (string, error) {
	return s.referenceURL(ctx, tenantID, callerID, asset)
}

func (s *Store) PlatformReferenceURL(ctx context.Context, tenantID, callerID string, asset domainasset.Asset) (string, error) {
	return s.referenceURL(ctx, tenantID, callerID, asset)
}

func (s *Store) referenceURL(ctx context.Context, _, _ string, asset domainasset.Asset) (string, error) {
	contentType := strings.TrimSpace(asset.ContentType)
	if contentType == "" {
		contentType = defaultContentType
	}
	namespace := knowledgeNamespace(asset.ArtifactNamespace)
	values, err := s.client.BatchPublicURLs(ctx, []storage.Artifact{{Namespace: namespace, ID: asset.ArtifactID, ContentType: contentType}})
	if err != nil {
		return "", fmt.Errorf("presign artifact: %w", err)
	}
	value, ok := values[storage.ArtifactLookupKey(namespace, asset.ArtifactID)]
	if !ok || strings.TrimSpace(value.URL) == "" {
		return "", errors.New("presign artifact returned no URL")
	}
	return s.absoluteURL(value.URL), nil
}

func (s *Store) Persist(ctx context.Context, input applicationvideogeneration.CanvasNodeVideoResultInput) (applicationvideogeneration.PersistedCanvasNodeVideo, error) {
	stored, namespace, err := s.persistRemote(ctx, input.TenantID, input.WorkspaceID, input.ProjectID, input.SourceURL)
	if err != nil {
		return applicationvideogeneration.PersistedCanvasNodeVideo{}, err
	}
	return applicationvideogeneration.PersistedCanvasNodeVideo{ArtifactID: stored.ArtifactID, ArtifactNamespace: namespace, SizeBytes: stored.Size}, nil
}

func (s *Store) PersistImage(ctx context.Context, input applicationimagegeneration.PersistImageInput) (applicationimagegeneration.PersistedImage, error) {
	stored, namespace, err := s.persistRemote(ctx, input.TenantID, input.WorkspaceID, input.ProjectID, input.SourceURL)
	if err != nil {
		return applicationimagegeneration.PersistedImage{}, err
	}
	return applicationimagegeneration.PersistedImage{ArtifactID: stored.ArtifactID, ArtifactNamespace: namespace, SizeBytes: stored.Size}, nil
}

func (s *Store) persistRemote(ctx context.Context, tenantID string, workspaceID *string, projectID, sourceURL string) (storage.StoredObject, string, error) {
	parsed, err := url.Parse(strings.TrimSpace(sourceURL))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return storage.StoredObject{}, "", errors.New("generated media URL must be an absolute HTTP(S) URL")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return storage.StoredObject{}, "", err
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return storage.StoredObject{}, "", fmt.Errorf("download generated media: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return storage.StoredObject{}, "", fmt.Errorf("download generated media returned status %d", response.StatusCode)
	}
	namespace, err := (artifactnamespace.Scope{TenantID: tenantID, WorkspaceID: workspaceID, ProjectID: &projectID}).Namespace()
	if err != nil {
		return storage.StoredObject{}, "", err
	}
	stored, err := s.client.PutObject(ctx, knowledgeNamespace(namespace), response.Body)
	if err != nil {
		return storage.StoredObject{}, "", fmt.Errorf("persist generated media: %w", err)
	}
	return stored, namespace, nil
}

func (s *Store) absoluteURL(raw string) string {
	if parsed, err := url.Parse(raw); err == nil && parsed.IsAbs() {
		return parsed.String()
	}
	if s.publicGatewayURL == "" {
		return raw
	}
	return s.publicGatewayURL + "/" + strings.TrimLeft(raw, "/")
}

func classifyContentType(contentType string) (domainasset.MediaType, bool) {
	contentType = strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	switch contentType {
	case "image/jpeg", "image/png", "image/webp", "image/bmp", "image/tiff", "image/gif", "image/heic", "image/heic-sequence", "image/heif", "image/heif-sequence":
		return domainasset.MediaImage, true
	case "video/mp4", "video/quicktime":
		return domainasset.MediaVideo, true
	case "audio/wav", "audio/x-wav", "audio/mpeg":
		return domainasset.MediaAudio, true
	default:
		return 0, false
	}
}
