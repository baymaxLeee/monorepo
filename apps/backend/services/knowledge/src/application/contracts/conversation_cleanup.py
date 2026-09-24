from pydantic import BaseModel, Field


class CleanupConversationArtifactsInput(BaseModel):
    conversation_id: str = Field(min_length=1, max_length=32)
    user_id: str = Field(min_length=1, max_length=26)
    workspace_id: str = Field(min_length=1, max_length=26)
    tenant_id: str = Field(min_length=1, max_length=26)


class CleanupConversationArtifactsResult(BaseModel):
    conversation_id: str
    deleted_documents: int
    deleted_generations: int
    deleted_blocks: int
    deleted_staged_media: int
    released_asset_claims: int
