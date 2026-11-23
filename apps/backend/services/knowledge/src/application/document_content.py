"""Publish editable semantic document text as immutable Storage revisions."""

from hashlib import sha256

from knowledge_kernel.errors import ConflictError

from application.storage_client import StorageRevision, get_storage_client


async def store_document_text(*, filename: str, media_type: str, content: str, operation_id: str) -> StorageRevision:
    encoded = content.encode()
    digest = sha256(encoded).hexdigest()
    key = sha256(f"{operation_id}\0{filename}\0{media_type}\0{digest}".encode()).hexdigest()
    revision = await get_storage_client().upload_text(
        filename=filename.rsplit("/", 1)[-1],
        media_type=media_type,
        content=content,
        idempotency_key=key,
    )
    if revision.sha256 != digest or revision.size_bytes != len(encoded):
        raise ConflictError("Storage revision does not match the submitted document content")
    return revision
