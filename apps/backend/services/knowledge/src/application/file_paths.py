import re

from infrastructure.persistence.models.document import DocumentRow


def source_path(row: DocumentRow) -> str:
    filename = re.sub(r"[^a-zA-Z0-9._\-\u4e00-\u9fff]+", "-", row.source_filename or row.filename).strip("-.")
    return f"sources/{row.id[:8]}-{filename or 'file'}"
