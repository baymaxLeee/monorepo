"""Provider connectivity tests by provider_kind."""

from __future__ import annotations

import time
from typing import Any, Literal, cast

import httpx
from openai import APIError, AsyncOpenAI, AuthenticationError
from schemas.provider import TestModelProviderResult

CHAT_RESERVED_KEYS = frozenset({"model", "messages", "max_tokens", "stream"})
IMAGE_RESERVED_KEYS = frozenset({"model", "prompt", "response_format", "n"})
EMBEDDING_RESERVED_KEYS = frozenset({"model", "input", "encoding_format"})
VIDEO_TASKS_PATH = "/contents/generations/tasks"


def _ark_api_root(base_url: str) -> str:
    """Normalize Ark base URL to ``.../api/v3`` (strip known resource suffixes)."""
    root = base_url.strip().rstrip("/")
    for suffix in (
        VIDEO_TASKS_PATH,
        "/images/generations",
        "/chat/completions",
    ):
        if root.endswith(suffix):
            root = root[: -len(suffix)].rstrip("/")
    return root


def _video_tasks_url(base_url: str) -> str:
    return f"{_ark_api_root(base_url)}{VIDEO_TASKS_PATH}"


def _openai_client(api_key: str, base_url: str) -> AsyncOpenAI:
    return AsyncOpenAI(
        api_key=api_key,
        base_url=_ark_api_root(base_url),
        timeout=120.0,
        http_client=httpx.AsyncClient(follow_redirects=False),
    )


def _split_extra_body(
    extra_body: dict[str, Any],
    reserved: frozenset[str],
) -> dict[str, Any]:
    passthrough: dict[str, Any] = {}
    for key, value in extra_body.items():
        if key in reserved:
            continue
        passthrough[key] = value
    return passthrough


async def test_chat_provider(
    *,
    base_url: str,
    api_key: str,
    model: str,
    extra_body: dict[str, Any],
) -> TestModelProviderResult:
    client = _openai_client(api_key, base_url)
    start = time.perf_counter()
    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": "ping"},
            ],
            max_tokens=16,
            stream=False,
            extra_body=_split_extra_body(extra_body, CHAT_RESERVED_KEYS) or None,
        )
    except AuthenticationError as exc:
        return TestModelProviderResult(ok=False, error=f"authentication: {exc}")
    except APIError as exc:
        return TestModelProviderResult(ok=False, error=f"api: {exc}")
    except Exception as exc:
        return TestModelProviderResult(ok=False, error=f"unexpected: {exc}")
    finally:
        await client.close()

    latency_ms = int((time.perf_counter() - start) * 1000)
    sample = ""
    if resp.choices:
        sample = (resp.choices[0].message.content or "").strip()
    return TestModelProviderResult(
        ok=True,
        latency_ms=latency_ms,
        sample=sample[:500] if sample else None,
    )


async def test_image_provider(
    *,
    base_url: str,
    api_key: str,
    model: str,
    extra_body: dict[str, Any],
) -> TestModelProviderResult:
    client = _openai_client(api_key, base_url)
    prompt = str(extra_body.get("test_prompt") or "连通性测试: 一只简笔画风格的小猫。")
    size = str(extra_body.get("size") or "2K")
    response_format_raw = str(extra_body.get("response_format") or "url")
    response_format = cast(Literal["url", "b64_json"], response_format_raw)
    passthrough = _split_extra_body(extra_body, IMAGE_RESERVED_KEYS | {"test_prompt"})
    start = time.perf_counter()
    try:
        resp = await client.images.generate(
            model=model,
            prompt=prompt,
            size=size,
            response_format=response_format,
            extra_body=passthrough or None,
        )
    except AuthenticationError as exc:
        return TestModelProviderResult(ok=False, error=f"authentication: {exc}")
    except APIError as exc:
        return TestModelProviderResult(ok=False, error=f"api: {exc}")
    except Exception as exc:
        return TestModelProviderResult(ok=False, error=f"unexpected: {exc}")
    finally:
        await client.close()

    latency_ms = int((time.perf_counter() - start) * 1000)
    sample = None
    if resp.data:
        first = resp.data[0]
        sample = (getattr(first, "url", None) or getattr(first, "b64_json", None) or "")[:500] or None
    return TestModelProviderResult(ok=True, latency_ms=latency_ms, sample=sample)


async def test_video_provider(
    *,
    base_url: str,
    api_key: str,
    model: str,
    extra_body: dict[str, Any],
) -> TestModelProviderResult:
    del extra_body
    tasks_url = _video_tasks_url(base_url)
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    start = time.perf_counter()
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(15.0, connect=10.0),
            follow_redirects=False,
        ) as client:
            response = await client.get(
                tasks_url,
                headers=headers,
                params={"page_num": 1, "page_size": 1},
            )
            if response.status_code in {401, 403}:
                return TestModelProviderResult(ok=False, error="authentication: invalid API key")
            if response.status_code >= 400:
                return TestModelProviderResult(
                    ok=False,
                    error=(f"api: HTTP {response.status_code} GET {tasks_url}: {response.text[:500]}"),
                )
            latency_ms = int((time.perf_counter() - start) * 1000)
            return TestModelProviderResult(
                ok=True,
                latency_ms=latency_ms,
                sample=f"Ark video API authenticated; model {model} was not invoked",
            )
    except httpx.HTTPError as exc:
        return TestModelProviderResult(ok=False, error=f"http: {exc}")
    except Exception as exc:
        return TestModelProviderResult(ok=False, error=f"unexpected: {exc}")


def _is_multimodal_embedding_model(model: str) -> bool:
    """Ark multimodal embedding models (doubao-embedding-vision-*) use the
    dedicated `/embeddings/multimodal` endpoint, not the text `/embeddings`."""
    lowered = model.lower()
    return "vision" in lowered or "multimodal" in lowered


async def _test_multimodal_embedding(
    *,
    base_url: str,
    api_key: str,
    model: str,
) -> TestModelProviderResult:
    url = f"{_ark_api_root(base_url)}/embeddings/multimodal"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    start = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0), follow_redirects=False) as client:
            response = await client.post(
                url,
                headers=headers,
                json={"model": model, "input": [{"type": "text", "text": "connectivity ping"}]},
            )
            if response.status_code in {401, 403}:
                return TestModelProviderResult(ok=False, error="authentication: invalid API key")
            if response.status_code >= 400:
                return TestModelProviderResult(
                    ok=False, error=f"api: HTTP {response.status_code}: {response.text[:500]}"
                )
            data = response.json()
    except httpx.HTTPError as exc:
        return TestModelProviderResult(ok=False, error=f"http: {exc}")
    except Exception as exc:
        return TestModelProviderResult(ok=False, error=f"unexpected: {exc}")
    latency_ms = int((time.perf_counter() - start) * 1000)
    embedding = _extract_embedding(data)
    dim = len(embedding) if isinstance(embedding, list) else 0
    return TestModelProviderResult(ok=True, latency_ms=latency_ms, sample=f"multimodal embedding dim={dim}")


def _extract_embedding(data: dict[str, Any]) -> list[Any] | None:
    """Ark multimodal `/embeddings/multimodal` returns `data` as a single object
    ({"embedding": [...]}); the text `/embeddings` returns a list. Handle both."""
    payload = data.get("data")
    if isinstance(payload, dict):
        embedding = payload.get("embedding")
    elif isinstance(payload, list) and payload:
        first = payload[0]
        embedding = first.get("embedding") if isinstance(first, dict) else None
    else:
        embedding = None
    return embedding if isinstance(embedding, list) else None


async def test_embedding_provider(
    *,
    base_url: str,
    api_key: str,
    model: str,
    extra_body: dict[str, Any],
) -> TestModelProviderResult:
    if _is_multimodal_embedding_model(model):
        return await _test_multimodal_embedding(base_url=base_url, api_key=api_key, model=model)
    client = _openai_client(api_key, base_url)
    start = time.perf_counter()
    try:
        resp = await client.embeddings.create(
            model=model,
            input="connectivity ping",
            extra_body=_split_extra_body(extra_body, EMBEDDING_RESERVED_KEYS) or None,
        )
    except AuthenticationError as exc:
        return TestModelProviderResult(ok=False, error=f"authentication: {exc}")
    except APIError as exc:
        return TestModelProviderResult(ok=False, error=f"api: {exc}")
    except Exception as exc:
        return TestModelProviderResult(ok=False, error=f"unexpected: {exc}")
    finally:
        await client.close()

    latency_ms = int((time.perf_counter() - start) * 1000)
    dim = len(resp.data[0].embedding) if resp.data else 0
    return TestModelProviderResult(ok=True, latency_ms=latency_ms, sample=f"embedding dim={dim}")


async def test_provider_by_kind(
    *,
    provider_kind: str,
    base_url: str,
    api_key: str,
    model: str,
    extra_body: dict[str, Any],
) -> TestModelProviderResult:
    if provider_kind == "image":
        return await test_image_provider(
            base_url=base_url,
            api_key=api_key,
            model=model,
            extra_body=extra_body,
        )
    if provider_kind == "video":
        return await test_video_provider(
            base_url=base_url,
            api_key=api_key,
            model=model,
            extra_body=extra_body,
        )
    if provider_kind == "embedding":
        return await test_embedding_provider(
            base_url=base_url,
            api_key=api_key,
            model=model,
            extra_body=extra_body,
        )
    if provider_kind == "rerank":
        return TestModelProviderResult(ok=True, sample="rerank provider saved; live test not implemented")
    return await test_chat_provider(
        base_url=base_url,
        api_key=api_key,
        model=model,
        extra_body=extra_body,
    )
