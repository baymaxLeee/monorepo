from dataclasses import dataclass


@dataclass(frozen=True)
class AuthContext:
    user_id: str
    username: str
    email: str
    workspace_id: str
    tenant_id: str
    workspace_role: str = ""

    @property
    def is_workspace_admin(self) -> bool:
        return self.workspace_role == "workspace_admin"
