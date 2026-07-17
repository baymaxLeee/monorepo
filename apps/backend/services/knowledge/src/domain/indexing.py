from dataclasses import dataclass
from typing import Literal

IndexOutcome = Literal["indexed", "skipped", "failed"]


@dataclass(frozen=True)
class IndexResult:
    status: IndexOutcome
    indexed: int = 0
    reason: str | None = None
