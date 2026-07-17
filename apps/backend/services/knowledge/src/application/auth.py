from dataclasses import dataclass


@dataclass(frozen=True)
class AuthContext:
    user_id: str
    username: str
    email: str
    org_id: str
    org_role: str = ""

    @property
    def is_org_admin(self) -> bool:
        return self.org_role == "org_admin"
