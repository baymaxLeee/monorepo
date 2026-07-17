from dataclasses import dataclass

PLATFORM_SUPER_ADMIN = "super_admin"


@dataclass(frozen=True)
class AuthContext:
    user_id: str
    username: str
    email: str
    org_id: str = ""
    org_role: str = ""
    roles: tuple[str, ...] = ()

    @property
    def is_super_admin(self) -> bool:
        return PLATFORM_SUPER_ADMIN in self.roles

    @property
    def is_org_admin(self) -> bool:
        return self.org_role == "org_admin"

    @property
    def can_write_org_config(self) -> bool:
        return self.is_org_admin
