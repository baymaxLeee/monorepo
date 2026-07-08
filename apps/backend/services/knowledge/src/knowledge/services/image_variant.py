"""On-demand downscaled image variants for vision-model input.

Vision models downsample images internally before inference (OpenAI tiles at
<=2048px, Anthropic at <=~1568px long edge), so sending a raw multi-megapixel
photo wastes tokens/latency and can stall weaker providers on request size. We
derive a normalized variant — longest edge <= ``max_dim``, re-encoded JPEG — from
the stored original and cache it in the object store keyed by the source content
hash + params, so repeated conversation turns never re-encode. This is exactly
what desktop chat clients do (resize to ~1568px before the model ever sees it);
here it runs server-side so the original is preserved for download and RAG.
"""

from __future__ import annotations

import io
import warnings

from kernel.errors import BaseError, RequestError
from knowledge.services.object_store import ObjectStore, ObjectStoreError
from PIL import Image, ImageOps, UnidentifiedImageError

_JPEG_QUALITY = 82
_VARIANT_PREFIX = "variants"
_MAX_SOURCE_BYTES = 32 * 1024 * 1024
_MAX_SOURCE_PIXELS = 40_000_000


class VisionVariantError(RequestError):
    code = "vision_variant_failed"


class VisionVariantTooLargeError(BaseError):
    status_code = 413
    code = "vision_variant_too_large"


def _variant_key(object_sha256: str, max_dim: int) -> str:
    return f"{_VARIANT_PREFIX}/{object_sha256}/vision-{max_dim}.jpg"


def _to_rgb(image: Image.Image) -> Image.Image:
    has_alpha = image.mode in {"RGBA", "LA", "PA"} or "A" in image.getbands() or "transparency" in image.info
    if not has_alpha:
        return image if image.mode == "RGB" else image.convert("RGB")
    rgba = image.convert("RGBA")
    background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    return Image.alpha_composite(background, rgba).convert("RGB")


def build_vision_variant(content: bytes, *, max_dim: int) -> bytes:
    if len(content) > _MAX_SOURCE_BYTES:
        raise VisionVariantTooLargeError(
            "image source is too large for vision variant generation",
            details={"max_bytes": _MAX_SOURCE_BYTES, "actual_bytes": len(content)},
        )
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as opened:
                pixels = opened.width * opened.height
                if pixels > _MAX_SOURCE_PIXELS:
                    raise VisionVariantTooLargeError(
                        "image pixel count is too large for vision variant generation",
                        details={"max_pixels": _MAX_SOURCE_PIXELS, "actual_pixels": pixels},
                    )
                image = _to_rgb(ImageOps.exif_transpose(opened))
                image.thumbnail((max_dim, max_dim))
                out = io.BytesIO()
                image.save(out, format="JPEG", quality=_JPEG_QUALITY, optimize=True)
                return out.getvalue()
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise VisionVariantTooLargeError("image is too large for vision variant generation") from exc
    except UnidentifiedImageError as exc:
        raise VisionVariantError("image source could not be decoded") from exc
    except OSError as exc:
        raise VisionVariantError("image source could not be converted") from exc


def get_or_build_vision_variant(
    *,
    object_sha256: str,
    object_bucket: str,
    object_key: str,
    max_dim: int,
    store: ObjectStore | None = None,
) -> bytes:
    """Return the cached vision variant or build + cache it. Blocking (Pillow +
    file IO); call via ``anyio.to_thread.run_sync`` from async handlers."""
    store = store or ObjectStore()
    variant_key = _variant_key(object_sha256, max_dim)
    try:
        return store.get_bytes(bucket=object_bucket, key=variant_key)
    except ObjectStoreError:
        pass
    original = store.get_bytes(bucket=object_bucket, key=object_key)
    variant = build_vision_variant(original, max_dim=max_dim)
    store.put_bytes_at(bucket=object_bucket, key=variant_key, content=variant)
    return variant
