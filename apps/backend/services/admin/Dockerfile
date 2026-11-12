FROM python:3.14.5-slim AS builder

ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY --from=ghcr.io/astral-sh/uv:0.13.6 /uv /uvx /bin/

WORKDIR /app

# Build context = apps/backend, so copies are workspace-root-relative.
COPY pyproject.toml uv.lock /app/
COPY libs/kernel /app/libs/kernel
COPY services/admin/pyproject.toml /app/services/admin/pyproject.toml

WORKDIR /app/services/admin
RUN uv sync --frozen --no-dev

COPY services/admin /app/services/admin

# ─── runtime ────────────────────────────────────────────
FROM python:3.14.5-slim
COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/libs/kernel /app/libs/kernel
COPY --from=builder /app/services/admin /app/services/admin
ENV PATH="/app/.venv/bin:$PATH"
WORKDIR /app/services/admin

EXPOSE 8001
CMD ["uvicorn", "main:app", "--app-dir", "src", "--host", "0.0.0.0", "--port", "8001", "--no-access-log"]
