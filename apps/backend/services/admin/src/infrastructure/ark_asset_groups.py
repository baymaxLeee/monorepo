"""Volcengine Ark asset-group lifecycle used by Canvas benefit packages."""

import hashlib
import hmac
import json
from datetime import UTC, datetime
from urllib.parse import quote, urlparse

import httpx
from kernel.errors import BaseError

_API_VERSION = "2024-01-01"
_DEFAULT_ENDPOINT = "https://ark.cn-beijing.volcengineapi.com"
_REGION = "cn-beijing"
_SERVICE = "ark"


class AssetGroupDependencyError(BaseError):
    status_code = 502
    code = "asset_group_dependency_error"


class AssetGroupClient:
    def __init__(self, endpoint: str = _DEFAULT_ENDPOINT, client: httpx.AsyncClient | None = None) -> None:
        self._endpoint = endpoint.rstrip("/")
        self._client = client

    async def create(self, *, name: str, project_name: str, access_key_id: str, secret_access_key: str) -> str:
        result = await self._call(
            "CreateAssetGroup",
            {
                "Name": name,
                "Description": "AgentFrame 高级创作权益包",
                "GroupType": "AIGC",
                "ProjectName": project_name,
            },
            access_key_id,
            secret_access_key,
        )
        group_id = result.get("Id")
        if not isinstance(group_id, str) or not group_id.strip():
            raise AssetGroupDependencyError("Ark 创建素材组响应缺少 Id")
        return group_id.strip()

    async def delete(self, *, group_id: str, project_name: str, access_key_id: str, secret_access_key: str) -> None:
        await self._call(
            "DeleteAssetGroup",
            {"Id": group_id, "ProjectName": project_name},
            access_key_id,
            secret_access_key,
        )

    async def create_asset(
        self,
        *,
        group_id: str,
        url: str,
        asset_type: str,
        name: str,
        project_name: str,
        access_key_id: str,
        secret_access_key: str,
    ) -> str:
        result = await self._call(
            "CreateAsset",
            {"GroupId": group_id, "URL": url, "AssetType": asset_type, "Name": name, "ProjectName": project_name},
            access_key_id,
            secret_access_key,
        )
        asset_id = result.get("Id")
        if not isinstance(asset_id, str) or not asset_id.strip():
            raise AssetGroupDependencyError("Ark 创建送审素材响应缺少 Id")
        return asset_id.strip()

    async def get_asset(
        self,
        *,
        asset_id: str,
        project_name: str,
        access_key_id: str,
        secret_access_key: str,
    ) -> tuple[str, str]:
        result = await self._call(
            "GetAsset",
            {"Id": asset_id, "ProjectName": project_name},
            access_key_id,
            secret_access_key,
        )
        status = result.get("Status")
        if not isinstance(status, str) or not status.strip():
            raise AssetGroupDependencyError("Ark 查询送审素材响应缺少 Status")
        reason = next(
            (str(result[key]).strip() for key in ("Reason", "FailureReason", "Message") if result.get(key)),
            "",
        )
        return status.strip(), reason

    async def delete_asset(
        self, *, asset_id: str, project_name: str, access_key_id: str, secret_access_key: str
    ) -> None:
        await self._call(
            "DeleteAsset",
            {"Id": asset_id, "ProjectName": project_name},
            access_key_id,
            secret_access_key,
        )

    async def _call(
        self, action: str, payload: dict[str, object], access_key_id: str, secret_access_key: str
    ) -> dict[str, object]:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
        parsed = urlparse(self._endpoint)
        if parsed.scheme != "https" or not parsed.hostname:
            raise AssetGroupDependencyError("Ark 素材组服务地址无效")
        params = {"Action": action, "Version": _API_VERSION}
        headers = _signed_headers(
            host=parsed.netloc,
            body=body,
            query=params,
            access_key_id=access_key_id,
            secret_access_key=secret_access_key,
        )
        try:
            if self._client is None:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.post(self._endpoint, params=params, headers=headers, content=body)
            else:
                response = await self._client.post(self._endpoint, params=params, headers=headers, content=body)
            if action == "DeleteAsset" and response.status_code == 404:
                return {}
            response.raise_for_status()
            decoded = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise AssetGroupDependencyError(f"Ark {action} 调用失败") from exc
        result = decoded.get("Result") if isinstance(decoded, dict) else None
        if not isinstance(result, dict):
            raise AssetGroupDependencyError(f"Ark {action} 响应缺少 Result")
        return result


def _signed_headers(
    *, host: str, body: bytes, query: dict[str, str], access_key_id: str, secret_access_key: str
) -> dict[str, str]:
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    content_hash = hashlib.sha256(body).hexdigest()
    signed = {
        "content-type": "application/json",
        "host": host,
        "x-content-sha256": content_hash,
        "x-date": timestamp,
    }
    signed_names = ";".join(sorted(signed))
    canonical_headers = "".join(f"{key}:{signed[key]}\n" for key in sorted(signed))
    canonical_query = "&".join(
        f"{quote(key, safe='-_.~')}={quote(value, safe='-_.~')}" for key, value in sorted(query.items())
    )
    canonical_request = "\n".join(["POST", "/", canonical_query, canonical_headers, signed_names, content_hash])
    date = timestamp[:8]
    scope = f"{date}/{_REGION}/{_SERVICE}/request"
    string_to_sign = "\n".join(
        ["HMAC-SHA256", timestamp, scope, hashlib.sha256(canonical_request.encode()).hexdigest()]
    )
    date_key = hmac.new(secret_access_key.encode(), date.encode(), hashlib.sha256).digest()
    region_key = hmac.new(date_key, _REGION.encode(), hashlib.sha256).digest()
    service_key = hmac.new(region_key, _SERVICE.encode(), hashlib.sha256).digest()
    signing_key = hmac.new(service_key, b"request", hashlib.sha256).digest()
    signature = hmac.new(signing_key, string_to_sign.encode(), hashlib.sha256).hexdigest()
    return {
        "Content-Type": signed["content-type"],
        "Host": host,
        "X-Content-Sha256": content_hash,
        "X-Date": timestamp,
        "Authorization": (
            f"HMAC-SHA256 Credential={access_key_id}/{scope}, SignedHeaders={signed_names}, Signature={signature}"
        ),
    }
