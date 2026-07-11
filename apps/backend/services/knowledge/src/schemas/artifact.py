"""Internal contracts used by chat's durable artifact workflow."""

from typing import Any, Literal

from pydantic import BaseModel, Field

ArtifactMode = Literal["document", "presentation", "dashboard"]
HtmlValidationSeverity = Literal["error", "warning", "info"]
HtmlValidationCategory = Literal[
    "structure", "security", "template", "responsive", "accessibility", "navigation", "chart"
]


class HtmlValidationEvidence(BaseModel):
    kind: Literal["html", "css"]
    excerpt: str


class HtmlValidationFinding(BaseModel):
    code: str
    severity: HtmlValidationSeverity
    category: HtmlValidationCategory
    message: str
    suggestion: str
    block_id: str | None = None
    selector: str | None = None
    evidence: HtmlValidationEvidence | None = None


class HtmlValidationSummary(BaseModel):
    errors: int = Field(ge=0)
    warnings: int = Field(ge=0)
    infos: int = Field(ge=0)


class HtmlValidationMetrics(BaseModel):
    blocks: int = Field(ge=0)
    charts: int = Field(ge=0)
    internal_links: int = Field(ge=0)
    total_chars: int = Field(ge=0)


class HtmlValidationReport(BaseModel):
    schema_version: Literal[1]
    template_version: int = Field(ge=1)
    ok: bool
    content_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    summary: HtmlValidationSummary
    findings: list[HtmlValidationFinding]
    metrics: HtmlValidationMetrics


class ReserveArtifactGenerationInput(BaseModel):
    user_id: str = Field(min_length=1, max_length=26)
    org_id: str = Field(min_length=1, max_length=26)
    conversation_id: str | None = Field(default=None, max_length=32)
    title: str = Field(min_length=1, max_length=120)
    filename: str = Field(min_length=1, max_length=160)
    mode: ArtifactMode = "document"
    brief: str = Field(min_length=1, max_length=20_000)
    idempotency_key: str = Field(min_length=1, max_length=128)
    document_id: str | None = Field(default=None, max_length=32)


class FailArtifactGenerationInput(BaseModel):
    user_id: str = Field(min_length=1, max_length=26)
    error: str | None = Field(default=None, max_length=4000)


class CancelArtifactGenerationInput(BaseModel):
    user_id: str = Field(min_length=1, max_length=26)


class ArtifactBlockPlan(BaseModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]+$", min_length=1, max_length=80)
    type: str = Field(min_length=1, max_length=40)


class SaveArtifactPlanInput(BaseModel):
    user_id: str = Field(min_length=1, max_length=26)
    manifest: dict[str, Any]
    blocks: list[ArtifactBlockPlan] = Field(min_length=1, max_length=200)


class SaveArtifactBlockInput(BaseModel):
    user_id: str = Field(min_length=1, max_length=26)
    content: str = Field(min_length=1)
    failed: bool = False


class PublishArtifactRevisionInput(BaseModel):
    user_id: str = Field(min_length=1, max_length=26)
    org_id: str = Field(min_length=1, max_length=26)
    compiled_html: str = Field(min_length=1)
    validation_report: HtmlValidationReport


class ArtifactGeneration(BaseModel):
    id: str
    document_id: str
    status: str
    total_blocks: int
    completed_blocks: int
    failed_blocks: int
    error: str | None
    finished_at: str | None


class PublishedArtifactRevision(BaseModel):
    document_id: str
    title: str
    filename: str
    mime_type: str = "text/html"
    total_chars: int


class StoredArtifactBlock(BaseModel):
    id: str
    type: str
    position: int
    content: str


class ArtifactRevisionWorkspace(BaseModel):
    document_id: str
    manifest: dict[str, Any]
    blocks: list[StoredArtifactBlock]
