package assetreview

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/volcengine/volcengine-go-sdk/volcengine"
	"github.com/volcengine/volcengine-go-sdk/volcengine/credentials"
	"github.com/volcengine/volcengine-go-sdk/volcengine/session"
	"github.com/volcengine/volcengine-go-sdk/volcengine/universal"
	"github.com/volcengine/volcengine-go-sdk/volcengine/volcengineerr"

	applicationpackage "github.com/example/monorepo/canvas/internal/application/benefitpackage"
)

const (
	apiVersion            = "2024-01-01"
	serviceName           = "ark"
	region                = "cn-beijing"
	assetGroupDescription = "AgentFrame 高级创作权益包"
)

type Client struct {
	endpoint   string
	httpClient *http.Client
}

func NewClient() *Client { return &Client{httpClient: &http.Client{Timeout: 30 * time.Second}} }

func newClient(endpoint string, httpClient *http.Client) *Client {
	return &Client{endpoint: endpoint, httpClient: httpClient}
}

func (c *Client) CreateAssetGroup(ctx context.Context, input applicationpackage.CreateAssetGroupInput) (string, error) {
	response, err := c.call(ctx, input.AccessKeyID, input.SecretAccessKey, "CreateAssetGroup", map[string]any{
		"Name": input.Name, "Description": assetGroupDescription, "GroupType": "AIGC", "ProjectName": input.ProjectName,
	})
	if err != nil {
		return "", fmt.Errorf("create Ark asset group: %w", err)
	}
	return requiredString(response, "Id", "create Ark asset group")
}

func (c *Client) DeleteAssetGroup(ctx context.Context, input applicationpackage.DeleteAssetGroupInput) error {
	_, err := c.call(ctx, input.AccessKeyID, input.SecretAccessKey, "DeleteAssetGroup", map[string]any{"Id": input.AssetGroupID, "ProjectName": input.ProjectName})
	if err != nil {
		return fmt.Errorf("delete Ark asset group: %w", err)
	}
	return nil
}

func (c *Client) CreateAsset(ctx context.Context, input applicationpackage.CreateReviewedAssetInput) (string, error) {
	response, err := c.call(ctx, input.AccessKeyID, input.SecretAccessKey, "CreateAsset", map[string]any{
		"GroupId": input.AssetGroupID, "URL": input.URL, "AssetType": input.AssetType,
		"Name": input.Name, "ProjectName": input.ProjectName,
	}, 0)
	if err != nil {
		var failure volcengineerr.RequestFailure
		if errors.As(err, &failure) && failure.StatusCode() == http.StatusTooManyRequests {
			return "", fmt.Errorf("%w: code=%s request_id=%s", applicationpackage.ErrAssetReviewRateLimited, failure.Code(), failure.RequestID())
		}
		return "", fmt.Errorf("create Ark asset: %w", err)
	}
	return requiredString(response, "Id", "create Ark asset")
}

func (c *Client) GetAsset(ctx context.Context, input applicationpackage.GetReviewedAssetInput) (applicationpackage.ReviewedAsset, error) {
	response, err := c.call(ctx, input.AccessKeyID, input.SecretAccessKey, "GetAsset", map[string]any{
		"Id": input.ProviderAssetID, "ProjectName": input.ProjectName,
	})
	if err != nil {
		return applicationpackage.ReviewedAsset{}, fmt.Errorf("get Ark asset: %w", err)
	}
	status, err := requiredString(response, "Status", "get Ark asset")
	if err != nil {
		return applicationpackage.ReviewedAsset{}, err
	}
	result := applicationpackage.ReviewedAsset{Status: applicationpackage.ProviderAssetStatus(status)}
	for _, key := range []string{"Reason", "FailureReason", "Message"} {
		if value, ok := response[key].(string); ok && strings.TrimSpace(value) != "" {
			result.FailureReason = strings.TrimSpace(value)
			break
		}
	}
	return result, nil
}

func (c *Client) DeleteAsset(ctx context.Context, input applicationpackage.DeleteReviewedAssetInput) error {
	_, err := c.call(ctx, input.AccessKeyID, input.SecretAccessKey, "DeleteAsset", map[string]any{
		"Id": input.ProviderAssetID, "ProjectName": input.ProjectName,
	})
	if err != nil {
		var failure volcengineerr.RequestFailure
		if errors.As(err, &failure) {
			switch failure.StatusCode() {
			case http.StatusNotFound:
				return nil
			case http.StatusUnauthorized, http.StatusForbidden:
				return fmt.Errorf("%w: status=%d code=%s request_id=%s", applicationpackage.ErrAssetReviewAuthorization, failure.StatusCode(), failure.Code(), failure.RequestID())
			}
		}
		return fmt.Errorf("delete Ark asset: %w", err)
	}
	return nil
}

func (c *Client) call(ctx context.Context, accessKeyID, secretAccessKey, action string, body map[string]any, maxRetries ...int) (map[string]any, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	config := volcengine.NewConfig().WithCredentials(credentials.NewStaticCredentials(accessKeyID, secretAccessKey, "")).WithRegion(region)
	if len(maxRetries) > 0 {
		config.WithMaxRetries(maxRetries[0])
	}
	if c.endpoint != "" {
		config.WithEndpoint(c.endpoint)
	}
	config.WithHTTPClient(c.httpClientForContext(ctx))
	sess, err := session.NewSession(config)
	if err != nil {
		return nil, fmt.Errorf("create Volcengine session: %w", err)
	}
	response, err := universal.New(sess).DoCall(universal.RequestUniversal{ServiceName: serviceName, Action: action, Version: apiVersion, HttpMethod: universal.POST, ContentType: universal.ApplicationJSON}, &body)
	if err != nil {
		return nil, err
	}
	if response == nil {
		return nil, fmt.Errorf("ark %s response missing Result", action)
	}
	result, ok := (*response)["Result"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("ark %s response missing Result", action)
	}
	return result, nil
}

func (c *Client) httpClientForContext(ctx context.Context) *http.Client {
	baseClient := c.httpClient
	if baseClient == nil {
		baseClient = &http.Client{Timeout: 30 * time.Second}
	}
	client := *baseClient
	next := baseClient.Transport
	if next == nil {
		next = http.DefaultTransport
	}
	// universal.DoCall does not expose request.SetContext. Bind the caller
	// context on this per-call client without adding internal tracing headers;
	// cloning keeps concurrent calls isolated and preserves the base transport.
	client.Transport = roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		return next.RoundTrip(request.Clone(ctx))
	})
	return &client
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (roundTrip roundTripperFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return roundTrip(request)
}

func requiredString(response map[string]any, key, operation string) (string, error) {
	value, ok := response[key].(string)
	if !ok || strings.TrimSpace(value) == "" {
		return "", fmt.Errorf("%s: provider response missing %s", operation, key)
	}
	return strings.TrimSpace(value), nil
}
