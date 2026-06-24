#!/usr/bin/env python3
"""One-shot backfill: storage_objects + chat.conversation_documents → knowledge.documents.

Idempotent: skips rows whose id already exists in knowledge.documents.
Run manually after deploying knowledge and before decommissioning storage:

  cd apps/backend/services/knowledge && uv run python ../../../../scripts/migrate-storage-to-knowledge.py

Requires MYSQL_* env (or .env in knowledge service).
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import asyncmy

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps/backend/services/knowledge/src"))


async def main() -> None:
    host = os.environ.get("MYSQL_HOST", "127.0.0.1")
    port = int(os.environ.get("MYSQL_PORT", "3306"))
    user = os.environ.get("MYSQL_USER", "app")
    password = os.environ.get("MYSQL_PASSWORD", "dev")

    storage_db = os.environ.get("STORAGE_MYSQL_DATABASE", "storage")
    chat_db = os.environ.get("CHAT_MYSQL_DATABASE", "chat")
    knowledge_db = os.environ.get("MYSQL_DATABASE", "knowledge")

    conn = await asyncmy.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        autocommit=False,
    )
    try:
        async with conn.cursor() as cur:
            await cur.execute(f"USE `{knowledge_db}`")
            await cur.execute("SELECT id FROM documents")
            existing = {row[0] for row in await cur.fetchall()}

            inserted = 0

            # chat conversation_documents (metadata + content_md)
            await cur.execute(f"USE `{chat_db}`")
            await cur.execute(
                """
                SELECT d.id, d.conversation_id, c.user_id, d.kind, d.title, d.filename, d.mime_type,
                       d.content_md, d.source_size, d.source_mime_type, d.source_object_bucket,
                       d.source_object_key, d.source_sha256, d.source_filename,
                       d.ingest_status, d.ingest_progress, d.ingest_error, d.created_at, d.updated_at
                FROM conversation_documents d
                JOIN conversations c ON c.id = d.conversation_id
                """
            )
            chat_rows = await cur.fetchall()
            await cur.execute(f"USE `{knowledge_db}`")
            for row in chat_rows:
                doc_id = row[0]
                if doc_id in existing:
                    continue
                await cur.execute(
                    """
                    INSERT INTO documents (
                      id, user_id, conversation_id, kind, title, filename, mime_type,
                      content_md, source_size, source_mime_type, object_bucket, object_key,
                      object_sha256, source_filename, ingest_status, ingest_progress,
                      ingest_error, created_at, updated_at
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    """,
                    (
                        row[0],
                        row[2],
                        row[1],
                        row[3],
                        row[4],
                        row[5],
                        row[6],
                        row[7] or "",
                        row[8] or 0,
                        row[9],
                        row[10],
                        row[11],
                        row[12],
                        row[13],
                        row[14] or "ready",
                        row[15] or 100,
                        row[16],
                        row[17],
                        row[18],
                    ),
                )
                existing.add(doc_id)
                inserted += 1

            # storage_objects without chat row (orphan metadata only)
            await cur.execute(f"USE `{storage_db}`")
            await cur.execute(
                """
                SELECT id, owner_user_id, bucket, object_key, sha256, size_bytes,
                       content_type, original_filename, created_at
                FROM storage_objects
                """
            )
            storage_rows = await cur.fetchall()
            await cur.execute(f"USE `{knowledge_db}`")
            for row in storage_rows:
                obj_id = row[0]
                if obj_id in existing:
                    continue
                await cur.execute(
                    """
                    INSERT INTO documents (
                      id, user_id, conversation_id, kind, title, filename, mime_type,
                      content_md, source_size, source_mime_type, object_bucket, object_key,
                      object_sha256, source_filename, ingest_status, ingest_progress,
                      created_at, updated_at
                    ) VALUES (%s,%s,NULL,'source',%s,%s,%s,'',%s,%s,%s,%s,%s,%s,'ready',100,%s,%s)
                    """,
                    (
                        row[0],
                        row[1],
                        row[7] or row[3],
                        row[7] or row[3],
                        row[6] or "application/octet-stream",
                        row[5] or 0,
                        row[6],
                        row[2],
                        row[3],
                        row[4],
                        row[7],
                        row[8],
                        row[8],
                    ),
                )
                existing.add(obj_id)
                inserted += 1

            await conn.commit()
            print(f"✓ backfill complete: {inserted} rows inserted into {knowledge_db}.documents")
    finally:
        conn.close()
        await conn.wait_closed()


if __name__ == "__main__":
    asyncio.run(main())
