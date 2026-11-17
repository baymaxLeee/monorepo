package assetgroup

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/example/monorepo/admin/internal/application"
)

const endpoint = "https://ark.cn-beijing.volcengineapi.com"

type Client struct{ HTTP *http.Client }

func New() Client { return Client{HTTP: &http.Client{Timeout: 30 * time.Second}} }

func (c Client) Create(ctx context.Context, credentials application.AssetGroupCredentials, name, description string) (string, error) {
	result, err := c.call(ctx, "CreateAssetGroup", map[string]any{"Name": name, "Description": description, "GroupType": "AIGC", "ProjectName": credentials.ProjectName}, credentials)
	if err != nil {
		return "", err
	}
	id, _ := result["Id"].(string)
	if strings.TrimSpace(id) == "" {
		return "", application.NewError(502, "asset_group_dependency_error", "Ark 创建素材组响应缺少 Id")
	}
	return strings.TrimSpace(id), nil
}
func (c Client) Delete(ctx context.Context, credentials application.AssetGroupCredentials, groupID string) error {
	_, err := c.call(ctx, "DeleteAssetGroup", map[string]any{"Id": groupID, "ProjectName": credentials.ProjectName}, credentials)
	return err
}
func (c Client) CreateAsset(ctx context.Context, credentials application.AssetGroupCredentials, groupID, target, assetType, name string) (string, error) {
	result, err := c.call(ctx, "CreateAsset", map[string]any{"GroupId": groupID, "URL": target, "AssetType": assetType, "Name": name, "ProjectName": credentials.ProjectName}, credentials)
	if err != nil {
		return "", err
	}
	id, _ := result["Id"].(string)
	if strings.TrimSpace(id) == "" {
		return "", application.NewError(502, "asset_group_dependency_error", "Ark 创建送审素材响应缺少 Id")
	}
	return strings.TrimSpace(id), nil
}
func (c Client) GetAsset(ctx context.Context, credentials application.AssetGroupCredentials, assetID string) (string, string, error) {
	result, err := c.call(ctx, "GetAsset", map[string]any{"Id": assetID, "ProjectName": credentials.ProjectName}, credentials)
	if err != nil {
		return "", "", err
	}
	status, _ := result["Status"].(string)
	if strings.TrimSpace(status) == "" {
		return "", "", application.NewError(502, "asset_group_dependency_error", "Ark 查询送审素材响应缺少 Status")
	}
	reason := ""
	for _, key := range []string{"Reason", "FailureReason", "Message"} {
		if value := strings.TrimSpace(fmt.Sprint(result[key])); value != "" && value != "<nil>" {
			reason = value
			break
		}
	}
	return status, reason, nil
}
func (c Client) DeleteAsset(ctx context.Context, credentials application.AssetGroupCredentials, assetID string) error {
	_, err := c.call(ctx, "DeleteAsset", map[string]any{"Id": assetID, "ProjectName": credentials.ProjectName}, credentials)
	return err
}

func (c Client) call(ctx context.Context, action string, payload map[string]any, credentials application.AssetGroupCredentials) (map[string]any, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	query := url.Values{"Action": {action}, "Version": {"2024-01-01"}}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint+"?"+query.Encode(), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	for key, value := range signedHeaders("ark.cn-beijing.volcengineapi.com", body, map[string]string{"Action": action, "Version": "2024-01-01"}, credentials.AccessKeyID, credentials.SecretAccessKey) {
		request.Header.Set(key, value)
	}
	response, err := c.HTTP.Do(request)
	if err != nil {
		return nil, application.NewError(502, "asset_group_dependency_error", fmt.Sprintf("Ark %s 调用失败", action))
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	if action == "DeleteAsset" && response.StatusCode == http.StatusNotFound {
		return map[string]any{}, nil
	}
	if response.StatusCode == http.StatusTooManyRequests {
		return nil, application.NewError(429, "asset_group_rate_limited", fmt.Sprintf("Ark %s request was rate limited", action))
	}
	if response.StatusCode >= 400 {
		return nil, application.NewError(502, "asset_group_dependency_error", fmt.Sprintf("Ark %s 调用失败", action))
	}
	var decoded map[string]any
	if json.Unmarshal(raw, &decoded) != nil {
		return nil, application.NewError(502, "asset_group_dependency_error", fmt.Sprintf("Ark %s 响应无效", action))
	}
	result, ok := decoded["Result"].(map[string]any)
	if !ok {
		return nil, application.NewError(502, "asset_group_dependency_error", fmt.Sprintf("Ark %s 响应缺少 Result", action))
	}
	return result, nil
}

func signedHeaders(host string, body []byte, query map[string]string, access, secret string) map[string]string {
	timestamp := time.Now().UTC().Format("20060102T150405Z")
	contentHash := sha256.Sum256(body)
	hashText := hex.EncodeToString(contentHash[:])
	signed := map[string]string{"content-type": "application/json", "host": host, "x-content-sha256": hashText, "x-date": timestamp}
	keys := []string{}
	for key := range signed {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	names := strings.Join(keys, ";")
	headers := ""
	for _, key := range keys {
		headers += key + ":" + signed[key] + "\n"
	}
	queryKeys := []string{}
	for key := range query {
		queryKeys = append(queryKeys, key)
	}
	sort.Strings(queryKeys)
	parts := []string{}
	for _, key := range queryKeys {
		parts = append(parts, url.QueryEscape(key)+"="+url.QueryEscape(query[key]))
	}
	canonical := strings.Join([]string{"POST", "/", strings.Join(parts, "&"), headers, names, hashText}, "\n")
	canonicalHash := sha256.Sum256([]byte(canonical))
	date := timestamp[:8]
	scope := date + "/cn-beijing/ark/request"
	toSign := strings.Join([]string{"HMAC-SHA256", timestamp, scope, hex.EncodeToString(canonicalHash[:])}, "\n")
	dateKey := sign([]byte(secret), date)
	regionKey := sign(dateKey, "cn-beijing")
	serviceKey := sign(regionKey, "ark")
	signingKey := sign(serviceKey, "request")
	signature := hex.EncodeToString(sign(signingKey, toSign))
	return map[string]string{"Content-Type": "application/json", "Host": host, "X-Content-Sha256": hashText, "X-Date": timestamp, "Authorization": "HMAC-SHA256 Credential=" + access + "/" + scope + ", SignedHeaders=" + names + ", Signature=" + signature}
}
func sign(key []byte, value string) []byte {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(value))
	return mac.Sum(nil)
}
