from pydantic import BaseModel, Field, model_validator


class ForkConversationDocumentsInput(BaseModel):
    source_conversation_id: str = Field(min_length=1, max_length=32)
    conversation_id: str = Field(min_length=1, max_length=32)
    user_id: str = Field(min_length=1, max_length=26)
    tenant_id: str = Field(min_length=1, max_length=26)
    workspace_id: str = Field(min_length=1, max_length=26)

    @model_validator(mode="after")
    def separate_conversations(self):
        if self.source_conversation_id == self.conversation_id:
            raise ValueError("a fork must have a new conversation id")
        return self


class ForkConversationDocumentsResult(BaseModel):
    document_ids: dict[str, str]
