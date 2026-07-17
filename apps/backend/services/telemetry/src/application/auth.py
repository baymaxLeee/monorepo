from dataclasses import dataclass

ADMIN_ROLES = frozenset({"super_admin"})


@dataclass(frozen=True)
class AuthContext:
    user_id: str
    username: str
    email: str
    roles: tuple[str, ...] = ()

    @property
    def is_admin(self) -> bool:
        return not ADMIN_ROLES.isdisjoint(self.roles)


@dataclass(frozen=True)
class OptionalAuthContext:
    user_id: str | None
    username: str | None
    email: str | None
    client_ip: str
    user_agent: str
    roles: tuple[str, ...] = ()

    @property
    def is_admin(self) -> bool:
        return not ADMIN_ROLES.isdisjoint(self.roles)
