"""Storage revisions used by the semantic file tree."""

from hashlib import sha256

from infrastructure.persistence.models.file_store import FileChangeSetEntryRow, FileEntryRow
from kernel.errors import ConflictError

from application.storage_client import StorageRevision, get_storage_client


async def store_text(
    *, tenant_id: str, workspace_id: str, user_id: str, filename: str, media_type: str, content: str, operation_id: str
) -> StorageRevision:
    digest = sha256(content.encode()).hexdigest()
    key = sha256(f"{operation_id}\0{filename}\0{media_type}\0{digest}".encode()).hexdigest()
    revision = await get_storage_client().upload_text(
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        user_id=user_id,
        filename=filename.rsplit("/", 1)[-1],
        media_type=media_type,
        content=content,
        idempotency_key=key,
    )
    if revision.sha256 != digest or revision.size_bytes != len(content.encode()):
        raise ConflictError("Storage revision does not match the submitted content")
    return revision


async def read_text(row: FileEntryRow | FileChangeSetEntryRow, *, tenant_id: str, workspace_id: str) -> str:
    if not row.asset_id or not row.revision_id or row.size_bytes is None:
        raise ConflictError("file content migration to Storage must complete before serving this file")
    content = await get_storage_client().read(
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        asset_id=row.asset_id,
        revision_id=row.revision_id,
        max_bytes=row.size_bytes,
    )
    if sha256(content).hexdigest() != row.sha256:
        raise ConflictError("Storage content checksum does not match the file revision")
    return content.decode("utf-8")
