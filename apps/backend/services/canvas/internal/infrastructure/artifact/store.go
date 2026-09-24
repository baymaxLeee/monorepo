package artifact

import (
	"context"
	"encoding/base64"
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
	"github.com/example/monorepo/canvas/internal/infrastructure/assetclient"
)

const (
	defaultContentType              = "application/octet-stream"
	maxInlineProviderReferenceBytes = 10 * 1024 * 1024
	maxGeneratedMediaBytes          = 512 * 1024 * 1024
)

var generatedMediaHTTPClient = &http.Client{
	Transport: &http.Transport{
		Proxy: nil, ForceAttemptHTTP2: true, MaxIdleConns: 32, MaxIdleConnsPerHost: 4,
		IdleConnTimeout: 90 * time.Second, TLSHandshakeTimeout: 10 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second, DialContext: dialPublicAddress,
	},
	CheckRedirect: func(request *http.Request, _ []*http.Request) error {
		return validatePublicRemoteURL(request.URL)
	},
}

type Service interface {
	applicationasset.RevisionStore
	applicationvideogeneration.ReferenceResolver
	applicationimagegeneration.ReferenceResolver
	applicationvideogeneration.CanvasNodeVideoResultStore
	applicationimagegeneration.ImageResultStore
	PublicReferenceURL(context.Context, string, string, domainasset.Asset) (string, error)
	ProviderReference(context.Context, string, string, domainasset.Asset) (string, error)
	applicationprojectusage.TemporaryFileStore
}

type Store struct {
	client           *assetclient.Client
	publicGatewayURL string
}

func (store *Store) UploadPlatformRevision(
	ctx context.Context, tenantID string, workspaceID *string, userID, filename, mediaType, idempotencyKey string, body io.Reader,
) (applicationasset.ResolvedRevision, error) {
	revision, err := store.client.Upload(ctx, assetclient.UploadInput{
		TenantID: tenantID, WorkspaceID: workspaceValue(workspaceID), UserID: userID, Filename: filename,
		MediaType: mediaType, Category: "official_asset", IdempotencyKey: idempotencyKey, Body: body,
	})
	if err != nil {
		return applicationasset.ResolvedRevision{}, err
	}
	kind, ok := classifyContentType(revision.MediaType)
	if !ok {
		return applicationasset.ResolvedRevision{}, applicationasset.ErrUnsupportedFormat
	}
	return applicationasset.ResolvedRevision{
		SourceAssetID: revision.AssetID, SourceRevisionID: revision.RevisionID, MediaType: kind,
		ContentType: revision.MediaType, SizeBytes: revision.SizeBytes,
	}, nil
}

func New(client *assetclient.Client, publicGatewayURL string) Service {
	return &Store{client: client, publicGatewayURL: strings.TrimRight(publicGatewayURL, "/")}
}

func (store *Store) Resolve(
	ctx context.Context, tenantID, workspaceID string, ref applicationasset.RevisionRef,
) (applicationasset.ResolvedRevision, error) {
	revision, err := store.client.Describe(ctx, tenantID, workspaceID, assetclient.RevisionRef{
		AssetID: ref.SourceAssetID, RevisionID: ref.SourceRevisionID,
	})
	if err != nil {
		return applicationasset.ResolvedRevision{}, fmt.Errorf("describe platform asset revision: %w", err)
	}
	mediaType, ok := classifyContentType(revision.MediaType)
	if !ok {
		return applicationasset.ResolvedRevision{}, applicationasset.ErrUnsupportedFormat
	}
	return applicationasset.ResolvedRevision{
		SourceAssetID: revision.AssetID, SourceRevisionID: revision.RevisionID,
		Category: revision.Category, CreatedBy: revision.CreatedBy,
		MediaType: mediaType, ContentType: revision.MediaType, SizeBytes: revision.SizeBytes,
	}, nil
}

func (store *Store) BatchDeliveryURLs(
	ctx context.Context, tenantID, workspaceID string, refs []applicationasset.RevisionRef,
) (map[string]applicationasset.PresignedArtifact, error) {
	if len(refs) == 0 {
		return map[string]applicationasset.PresignedArtifact{}, nil
	}
	inputs := make([]assetclient.DeliveryCapabilityInput, len(refs))
	for index, ref := range refs {
		inputs[index] = assetclient.DeliveryCapabilityInput{
			TenantID: tenantID, WorkspaceID: workspaceID,
			RevisionRef: assetclient.RevisionRef{AssetID: ref.SourceAssetID, RevisionID: ref.SourceRevisionID},
		}
	}
	capabilities, err := store.client.MintDeliveryCapabilities(ctx, inputs)
	if err != nil {
		return nil, fmt.Errorf("mint asset delivery capabilities: %w", err)
	}
	result := make(map[string]applicationasset.PresignedArtifact, len(capabilities))
	for _, capability := range capabilities {
		result[revisionRefKey(capability.AssetID, capability.RevisionID)] = applicationasset.PresignedArtifact{
			URL: store.absoluteURL(capability.URL), ExpiresAt: capability.ExpiresAt,
		}
	}
	return result, nil
}

func (store *Store) PublicReferenceURL(ctx context.Context, _, _ string, asset domainasset.Asset) (string, error) {
	return store.referenceURL(ctx, asset)
}

func (store *Store) ProviderReference(ctx context.Context, _, _ string, asset domainasset.Asset) (string, error) {
	if asset.MediaType != domainasset.MediaImage {
		return store.referenceURL(ctx, asset)
	}
	if asset.SizeBytes <= 0 || asset.SizeBytes > maxInlineProviderReferenceBytes {
		return "", errors.New("provider reference image exceeds the 10 MiB inline limit")
	}
	contentType := normalizedContentType(asset.ContentType)
	if !strings.HasPrefix(contentType, "image/") {
		return "", errors.New("provider reference image has an invalid content type")
	}
	reader, err := store.client.Open(ctx, asset.TenantID, workspaceValue(asset.WorkspaceID), platformRef(asset))
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

func (store *Store) referenceURL(ctx context.Context, asset domainasset.Asset) (string, error) {
	workspaceID := workspaceValue(asset.WorkspaceID)
	if workspaceID == "" {
		return "", errors.New("platform asset delivery requires a workspace scope")
	}
	values, err := store.BatchDeliveryURLs(ctx, asset.TenantID, workspaceID, []applicationasset.RevisionRef{{
		SourceAssetID: asset.SourceAssetID, SourceRevisionID: asset.SourceRevisionID,
	}})
	if err != nil {
		return "", err
	}
	value, ok := values[revisionRefKey(asset.SourceAssetID, asset.SourceRevisionID)]
	if !ok || strings.TrimSpace(value.URL) == "" {
		return "", errors.New("asset delivery capability returned no URL")
	}
	return value.URL, nil
}

func (store *Store) Persist(ctx context.Context, input applicationvideogeneration.CanvasNodeVideoResultInput) (applicationvideogeneration.PersistedCanvasNodeVideo, error) {
	revision, err := store.persistRemote(ctx, input.TenantID, workspaceValue(input.WorkspaceID), input.CallerID, input.TaskRunID+".mp4", "generated_video", "video-generation:"+input.TaskRunID, input.SourceURL)
	if err != nil {
		return applicationvideogeneration.PersistedCanvasNodeVideo{}, err
	}
	return applicationvideogeneration.PersistedCanvasNodeVideo{SourceAssetID: revision.AssetID, SourceRevisionID: revision.RevisionID, SizeBytes: revision.SizeBytes}, nil
}

func (store *Store) PersistImage(ctx context.Context, input applicationimagegeneration.PersistImageInput) (applicationimagegeneration.PersistedImage, error) {
	revision, err := store.persistRemote(ctx, input.TenantID, workspaceValue(input.WorkspaceID), input.CallerID, input.TaskRunID+".png", "generated_image", "image-generation:"+input.TaskRunID, input.SourceURL)
	if err != nil {
		return applicationimagegeneration.PersistedImage{}, err
	}
	return applicationimagegeneration.PersistedImage{SourceAssetID: revision.AssetID, SourceRevisionID: revision.RevisionID, SizeBytes: revision.SizeBytes}, nil
}

func (store *Store) UploadTemporary(ctx context.Context, input applicationprojectusage.TemporaryFileUpload) (applicationprojectusage.TemporaryFile, error) {
	revision, err := store.client.Upload(ctx, assetclient.UploadInput{
		TenantID: input.TenantID, WorkspaceID: workspaceValue(input.WorkspaceID), UserID: input.CallerID,
		Filename: input.InternalFileName, MediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		Category: "project_usage_export", IdempotencyKey: "project-usage-export:" + input.ExportID, Body: input.Reader,
	})
	if err != nil {
		return applicationprojectusage.TemporaryFile{}, fmt.Errorf("upload project usage workbook: %w", err)
	}
	if revision.SizeBytes != input.Size || !strings.EqualFold(revision.SHA256, input.SHA256) {
		return applicationprojectusage.TemporaryFile{}, errors.New("uploaded project usage workbook integrity mismatch")
	}
	capabilities, err := store.client.MintDeliveryCapabilities(ctx, []assetclient.DeliveryCapabilityInput{{
		TenantID: input.TenantID, WorkspaceID: workspaceValue(input.WorkspaceID), RevisionRef: revision.RevisionRef,
	}})
	if err != nil || len(capabilities) != 1 {
		return applicationprojectusage.TemporaryFile{}, fmt.Errorf("mint project usage workbook capability: %w", err)
	}
	return applicationprojectusage.TemporaryFile{
		DownloadURL: store.absoluteURL(capabilities[0].URL), ExpiresAt: capabilities[0].ExpiresAt, Size: revision.SizeBytes,
	}, nil
}

func (store *Store) persistRemote(ctx context.Context, tenantID, workspaceID, userID, filename, category, idempotencyKey, sourceURL string) (assetclient.Revision, error) {
	parsed, err := url.Parse(strings.TrimSpace(sourceURL))
	if err != nil || validatePublicRemoteURL(parsed) != nil {
		return assetclient.Revision{}, errors.New("generated media URL must be an absolute HTTP(S) URL")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return assetclient.Revision{}, err
	}
	response, err := generatedMediaHTTPClient.Do(request)
	if err != nil {
		return assetclient.Revision{}, fmt.Errorf("download generated media: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return assetclient.Revision{}, fmt.Errorf("download generated media returned status %d", response.StatusCode)
	}
	if response.ContentLength > maxGeneratedMediaBytes {
		return assetclient.Revision{}, errors.New("generated media exceeds the 512 MiB limit")
	}
	limited := &io.LimitedReader{R: response.Body, N: maxGeneratedMediaBytes + 1}
	revision, err := store.client.Upload(ctx, assetclient.UploadInput{
		TenantID: tenantID, WorkspaceID: workspaceID, UserID: userID, Filename: filename,
		MediaType: response.Header.Get("Content-Type"), Category: category, IdempotencyKey: idempotencyKey, Body: limited,
	})
	if err != nil {
		return assetclient.Revision{}, fmt.Errorf("persist generated media: %w", err)
	}
	if revision.SizeBytes > maxGeneratedMediaBytes || limited.N <= 0 {
		return assetclient.Revision{}, errors.New("generated media exceeds the 512 MiB limit")
	}
	return revision, nil
}

func platformRef(asset domainasset.Asset) assetclient.RevisionRef {
	return assetclient.RevisionRef{AssetID: asset.SourceAssetID, RevisionID: asset.SourceRevisionID}
}

func revisionRefKey(assetID, revisionID string) string { return assetID + "\x00" + revisionID }

func workspaceValue(workspaceID *string) string {
	if workspaceID == nil {
		return ""
	}
	return strings.TrimSpace(*workspaceID)
}

func (store *Store) absoluteURL(raw string) string {
	if parsed, err := url.Parse(raw); err == nil && parsed.IsAbs() {
		return parsed.String()
	}
	if store.publicGatewayURL == "" {
		return raw
	}
	return store.publicGatewayURL + "/" + strings.TrimLeft(raw, "/")
}

func normalizedContentType(contentType string) string {
	return strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
}

func classifyContentType(contentType string) (domainasset.MediaType, bool) {
	switch normalizedContentType(contentType) {
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
