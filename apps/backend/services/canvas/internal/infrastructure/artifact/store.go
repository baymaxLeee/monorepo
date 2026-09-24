package artifact

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	applicationimagegeneration "github.com/example/monorepo/canvas/internal/application/imagegeneration"
	applicationprojectusage "github.com/example/monorepo/canvas/internal/application/projectusage"
	applicationvideogeneration "github.com/example/monorepo/canvas/internal/application/videogeneration"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	"github.com/example/monorepo/canvas/internal/infrastructure/storage"
	artifactnamespace "github.com/example/monorepo/canvas/internal/infrastructure/storage/namespace"
)

const (
	defaultContentType              = "application/octet-stream"
	stagingNamespace                = "canvas:blob-staging"
	maxInlineProviderReferenceBytes = 10 * 1024 * 1024
	maxGeneratedMediaBytes          = 512 * 1024 * 1024
)

var generatedMediaHTTPClient = &http.Client{
	Transport: &http.Transport{
		Proxy:                 nil,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          32,
		MaxIdleConnsPerHost:   4,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second,
		DialContext:           dialPublicAddress,
	},
	CheckRedirect: func(request *http.Request, _ []*http.Request) error {
		return validatePublicRemoteURL(request.URL)
	},
}

// Service is the application artifact boundary implemented by Knowledge.
type Service interface {
	applicationasset.ArtifactStore
	applicationvideogeneration.ReferenceResolver
	applicationimagegeneration.ReferenceResolver
	applicationvideogeneration.CanvasNodeVideoResultStore
	applicationimagegeneration.ImageResultStore
	PublicReferenceURL(context.Context, string, string, domainasset.Asset) (string, error)
	ProviderReference(context.Context, string, string, domainasset.Asset) (string, error)
	UploadBlob(context.Context, string, string, io.Reader) (string, int64, error)
	applicationprojectusage.TemporaryFileStore
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

func KnowledgeNamespace(namespace string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(namespace)))
	return hex.EncodeToString(digest[:])
}

func (s *Store) Inspect(ctx context.Context, _, _ string, blobID string) (applicationasset.DetectedBlob, error) {
	reader, err := s.client.Get(ctx, KnowledgeNamespace(stagingNamespace), strings.TrimSpace(blobID))
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
	stored, err := s.client.PutObject(ctx, KnowledgeNamespace(stagingNamespace), reader)
	if err != nil {
		return "", 0, fmt.Errorf("upload staged blob: %w", err)
	}
	if strings.TrimSpace(stored.ArtifactID) == "" || stored.Size <= 0 {
		return "", 0, errors.New("upload staged blob returned an invalid result")
	}
	return stored.ArtifactID, stored.Size, nil
}

func (s *Store) UploadTemporary(
	ctx context.Context,
	input applicationprojectusage.TemporaryFileUpload,
) (applicationprojectusage.TemporaryFile, error) {
	namespace := KnowledgeNamespace("canvas:project-usage:" + strings.TrimSpace(input.TenantID))
	stored, err := s.client.PutObject(ctx, namespace, input.Reader)
	if err != nil {
		return applicationprojectusage.TemporaryFile{}, fmt.Errorf("upload project usage workbook: %w", err)
	}
	if stored.Size != input.Size || !strings.EqualFold(stored.SHA256, input.SHA256) {
		_ = s.client.Delete(ctx, namespace, stored.ArtifactID)
		return applicationprojectusage.TemporaryFile{}, errors.New("uploaded project usage workbook integrity mismatch")
	}
	values, err := s.client.BatchPublicURLs(ctx, []storage.Artifact{{
		Namespace: namespace, ID: stored.ArtifactID,
		ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	}})
	if err != nil {
		_ = s.client.Delete(ctx, namespace, stored.ArtifactID)
		return applicationprojectusage.TemporaryFile{}, fmt.Errorf("presign project usage workbook: %w", err)
	}
	presigned, ok := values[storage.ArtifactLookupKey(namespace, stored.ArtifactID)]
	if !ok || strings.TrimSpace(presigned.URL) == "" {
		_ = s.client.Delete(ctx, namespace, stored.ArtifactID)
		return applicationprojectusage.TemporaryFile{}, errors.New("presign project usage workbook returned no URL")
	}
	expiresAt, err := time.Parse(time.RFC3339, presigned.ExpiresAt)
	if err != nil {
		_ = s.client.Delete(ctx, namespace, stored.ArtifactID)
		return applicationprojectusage.TemporaryFile{}, fmt.Errorf("parse project usage workbook expiry: %w", err)
	}
	return applicationprojectusage.TemporaryFile{
		DownloadURL: s.absoluteURL(presigned.URL), ExpiresAt: expiresAt, Size: stored.Size,
	}, nil
}

func (s *Store) Register(ctx context.Context, _, _ string, blobID, _ string, namespace string) (applicationasset.RegisteredArtifact, error) {
	reader, err := s.client.Get(ctx, KnowledgeNamespace(stagingNamespace), strings.TrimSpace(blobID))
	if err != nil {
		return applicationasset.RegisteredArtifact{}, fmt.Errorf("open staged blob: %w", err)
	}
	defer reader.Close()
	stored, err := s.client.PutObject(ctx, KnowledgeNamespace(namespace), reader)
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
	if err := s.client.Delete(ctx, KnowledgeNamespace(namespace), strings.TrimSpace(artifactID)); err != nil {
		return fmt.Errorf("delete artifact: %w", err)
	}
	return nil
}

func (s *Store) BatchPresignArtifacts(ctx context.Context, _, _ string, namespace string, artifactIDs []string) (map[string]applicationasset.PresignedArtifact, error) {
	resolvedNamespace := KnowledgeNamespace(namespace)
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

func (s *Store) PublicReferenceURL(ctx context.Context, tenantID, callerID string, asset domainasset.Asset) (string, error) {
	return s.referenceURL(ctx, tenantID, callerID, asset)
}

// ProviderReference keeps reviewed asset:// references in the application
// layer. For ordinary image assets it avoids asking a remote custom provider
// to fetch a URL hosted by a developer's localhost gateway.
func (s *Store) ProviderReference(ctx context.Context, tenantID, callerID string, asset domainasset.Asset) (string, error) {
	if asset.MediaType != domainasset.MediaImage {
		return s.referenceURL(ctx, tenantID, callerID, asset)
	}
	if asset.SizeBytes <= 0 || asset.SizeBytes > maxInlineProviderReferenceBytes {
		return "", errors.New("provider reference image exceeds the 10 MiB inline limit")
	}
	contentType := strings.ToLower(strings.TrimSpace(strings.Split(asset.ContentType, ";")[0]))
	if !strings.HasPrefix(contentType, "image/") {
		return "", errors.New("provider reference image has an invalid content type")
	}
	reader, err := s.client.Get(ctx, KnowledgeNamespace(asset.ArtifactNamespace), asset.ArtifactID)
	if err != nil {
		return "", fmt.Errorf("read provider reference image: %w", err)
	}
	defer reader.Close()
	payload, err := io.ReadAll(io.LimitReader(reader, maxInlineProviderReferenceBytes+1))
	if err != nil {
		return "", fmt.Errorf("read provider reference image: %w", err)
	}
	if len(payload) == 0 || len(payload) > maxInlineProviderReferenceBytes || int64(len(payload)) != asset.SizeBytes {
		return "", errors.New("provider reference image size does not match its asset metadata")
	}
	return "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(payload), nil
}

func (s *Store) referenceURL(ctx context.Context, _, _ string, asset domainasset.Asset) (string, error) {
	contentType := strings.TrimSpace(asset.ContentType)
	if contentType == "" {
		contentType = defaultContentType
	}
	namespace := KnowledgeNamespace(asset.ArtifactNamespace)
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
	if err != nil || validatePublicRemoteURL(parsed) != nil {
		return storage.StoredObject{}, "", errors.New("generated media URL must be an absolute HTTP(S) URL")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return storage.StoredObject{}, "", err
	}
	response, err := generatedMediaHTTPClient.Do(request)
	if err != nil {
		return storage.StoredObject{}, "", fmt.Errorf("download generated media: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return storage.StoredObject{}, "", fmt.Errorf("download generated media returned status %d", response.StatusCode)
	}
	if response.ContentLength > maxGeneratedMediaBytes {
		return storage.StoredObject{}, "", errors.New("generated media exceeds the 512 MiB limit")
	}
	namespace, err := (artifactnamespace.Scope{TenantID: tenantID, WorkspaceID: workspaceID, ProjectID: &projectID}).Namespace()
	if err != nil {
		return storage.StoredObject{}, "", err
	}
	limited := &io.LimitedReader{R: response.Body, N: maxGeneratedMediaBytes + 1}
	stored, err := s.client.PutObject(ctx, KnowledgeNamespace(namespace), limited)
	if err != nil {
		return storage.StoredObject{}, "", fmt.Errorf("persist generated media: %w", err)
	}
	if stored.Size > maxGeneratedMediaBytes || limited.N <= 0 {
		_ = s.client.Delete(ctx, KnowledgeNamespace(namespace), stored.ArtifactID)
		return storage.StoredObject{}, "", errors.New("generated media exceeds the 512 MiB limit")
	}
	return stored, namespace, nil
}

func validatePublicRemoteURL(candidate *url.URL) error {
	if candidate == nil || (candidate.Scheme != "http" && candidate.Scheme != "https") || candidate.User != nil {
		return errors.New("generated media URL must be an absolute HTTP(S) URL")
	}
	host := strings.ToLower(strings.TrimSuffix(candidate.Hostname(), "."))
	if host == "" {
		return errors.New("generated media URL must include a host")
	}
	if ip := net.ParseIP(host); ip != nil {
		if !publicRemoteIP(ip) {
			return errors.New("generated media URL cannot use a private network address")
		}
		return nil
	}
	if !strings.Contains(host, ".") || host == "localhost" || strings.HasSuffix(host, ".local") ||
		strings.HasSuffix(host, ".internal") || strings.HasSuffix(host, ".cluster.local") ||
		strings.HasSuffix(host, ".vke-system") {
		return errors.New("generated media URL cannot use an internal service address")
	}
	return nil
}

func publicRemoteIP(ip net.IP) bool {
	return ip.IsGlobalUnicast() && !ip.IsPrivate() && !ip.IsLoopback() &&
		!ip.IsLinkLocalUnicast() && !ip.IsLinkLocalMulticast() && !ip.IsUnspecified()
}

func dialPublicAddress(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, fmt.Errorf("parse generated media address: %w", err)
	}
	addresses, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, fmt.Errorf("resolve generated media host: %w", err)
	}
	if len(addresses) == 0 {
		return nil, errors.New("generated media host resolved to no addresses")
	}
	for _, address := range addresses {
		if !publicRemoteIP(address.IP) {
			return nil, errors.New("generated media host resolved to a private network address")
		}
	}
	dialer := net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	var lastErr error
	for _, resolved := range addresses {
		connection, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(resolved.IP.String(), port))
		if dialErr == nil {
			return connection, nil
		}
		lastErr = dialErr
	}
	return nil, fmt.Errorf("connect to generated media host: %w", lastErr)
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
