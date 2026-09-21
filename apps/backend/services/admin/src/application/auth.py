from dataclasses import dataclass

PLATFORM_SUPER_ADMIN = "super_admin"


@dataclass(frozen=True)
class AuthContext:
    user_id: str
    username: str
    email: str
    workspace_id: str = ""
    tenant_id: str = ""
    workspace_role: str = ""
    roles: tuple[str, ...] = ()

    @property
    def is_super_admin(self) -> bool:
        return PLATFORM_SUPER_ADMIN in self.roles

    @property
    def is_workspace_admin(self) -> bool:
        return self.workspace_role == "workspace_admin"

    @property
    def can_write_workspace_config(self) -> bool:
        return self.is_workspace_admin
