import hashlib
import logging

from infrastructure.persistence.database import get_session_factory, write_tx
from infrastructure.persistence.models.artifact import ArtifactBlockVersionRow
from infrastructure.persistence.models.document import DocumentRow
from sqlalchemy import select

from application.object_store import ObjectStore

logger = logging.getLogger("knowledge.artifact_object_convergence")


async def converge_artifact_block_objects() -> tuple[int, int]:
    factory = get_session_factory()
    async with factory() as session:
        versions = list((await session.scalars(select(ArtifactBlockVersionRow))).all())
        documents = list((await session.scalars(select(DocumentRow).where(DocumentRow.kind == "artifact"))).all())
    if not versions and not documents:
        return 0, 0

    store = ObjectStore()
    replacements: list[tuple[str, str, str, str]] = []
    for version in versions:
        expected_key = f"artifacts/{version.document_id}/blocks/{version.user_id}/{version.object_sha256}.json"
        if version.object_key == expected_key:
            continue
        content = store.get_bytes(bucket=version.object_bucket, key=version.object_key)
        if hashlib.sha256(content).hexdigest() != version.object_sha256:
            logger.error("artifact block %s content hash does not match its version", version.id)
            continue
        stored = store.put_bytes(
            content=content,
            filename=f"{version.object_sha256}.json",
            mime_type="application/json",
            user_id=version.user_id,
            prefix=f"artifacts/{version.document_id}/blocks",
        )
        replacements.append((version.id, stored.bucket, stored.key, version.object_key))

    document_replacements: list[tuple[str, str, str]] = []
    for document in documents:
        if not document.object_bucket or not document.object_key or not document.object_sha256:
            continue
        expected_key = f"artifacts/{document.id}/{document.user_id}/current.html"
        if document.object_key == expected_key:
            continue
        content = store.get_bytes(bucket=document.object_bucket, key=document.object_key)
        if hashlib.sha256(content).hexdigest() != document.object_sha256:
            logger.error("artifact document %s content hash does not match", document.id)
            continue
        stored = store.put_bytes(
            content=content,
            filename="current.html",
            mime_type="text/html",
            user_id=document.user_id,
            prefix=f"artifacts/{document.id}",
            max_bytes=len(content),
        )
        document_replacements.append((document.id, stored.bucket, stored.key))

    if replacements or document_replacements:
        async with factory() as session, write_tx(session):
            for version_id, bucket, key, _old_key in replacements:
                persisted = await session.get(ArtifactBlockVersionRow, version_id)
                if persisted is not None:
                    persisted.object_bucket = bucket
                    persisted.object_key = key
            for document_id, bucket, key in document_replacements:
                persisted_document = await session.get(DocumentRow, document_id)
                if persisted_document is not None:
                    persisted_document.object_bucket = bucket
                    persisted_document.object_key = key

    async with factory() as session:
        referenced = {
            (row.object_bucket, row.object_key)
            for row in (await session.scalars(select(ArtifactBlockVersionRow))).all()
        }
        artifact_documents = list(
            (await session.scalars(select(DocumentRow).where(DocumentRow.kind == "artifact"))).all()
        )
        referenced.update(
            (row.object_bucket, row.object_key) for row in artifact_documents if row.object_bucket and row.object_key
        )
    deleted = 0
    for bucket in {bucket for bucket, _key in referenced}:
        for key in store.list_keys(bucket=bucket, key_prefix="artifacts"):
            is_artifact_html = key.endswith(".html") and any(
                key.startswith(f"artifacts/{document.id}/") for document in artifact_documents
            )
            if ("/blocks/" not in key and not is_artifact_html) or (bucket, key) in referenced:
                continue
            store.delete(bucket=bucket, key=key)
            deleted += 1
    return len(replacements) + len(document_replacements), deleted
