from pydantic import BaseModel, Field, model_validator


class BenefitPackage(BaseModel):
    id: str
    is_preset: bool
    name: str
    project_name: str
    has_access_key_id: bool
    has_secret_access_key: bool
    enabled: bool
    model_ids: list[str]
    material_used: int
    revision: int
    created_by: str
    updated_by: str
    created_at: str
    updated_at: str


class CreateBenefitPackageInput(BaseModel):
    is_preset: bool = False
    name: str = Field(default="", max_length=80)
    project_name: str = Field(default="default", min_length=1, max_length=128)
    access_key_id: str = Field(min_length=1, max_length=4096)
    secret_access_key: str = Field(min_length=1, max_length=4096)
    enabled: bool = True
    model_ids: list[str] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def validate_kind(self) -> CreateBenefitPackageInput:
        if not self.is_preset and (not self.name.strip() or not self.model_ids):
            raise ValueError("custom package requires a name and at least one model")
        return self


class UpdateBenefitPackageInput(BaseModel):
    expected_revision: int = Field(ge=1)
    name: str | None = Field(default=None, min_length=1, max_length=80)
    project_name: str | None = Field(default=None, min_length=1, max_length=128)
    access_key_id: str | None = Field(default=None, min_length=1, max_length=4096)
    secret_access_key: str | None = Field(default=None, min_length=1, max_length=4096)
    enabled: bool | None = None
    model_ids: list[str] | None = Field(default=None, max_length=100)


class InternalBenefitPackage(BaseModel):
    id: str
    name: str
    project_name: str
    asset_group_id: str
    access_key_id: str
    secret_access_key: str
    is_preset: bool
    model_ids: list[str]


class AssetGroupCleanup(BaseModel):
    id: str
    benefit_package_id: str
    asset_group_id: str
    status: str
    attempts: int
    last_error: str
    created_at: str
    updated_at: str
    completed_at: str | None
