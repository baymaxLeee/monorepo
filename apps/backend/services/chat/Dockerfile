FROM python:3.14.5-slim AS builder

ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

WORKDIR /app

# Build context = apps/backend, so copies are workspace-root-relative.
COPY pyproject.toml uv.lock /app/
COPY services/chat /app/services/chat
COPY libs /app/libs

WORKDIR /app/services/chat
RUN uv sync --frozen --no-dev

# ─── runtime ────────────────────────────────────────────
FROM python:3.14.5-slim
WORKDIR /app
COPY --from=builder /app /app
# uv puts the venv at the workspace root (apps/backend = /app here), not at
# the member directory — so the bin/ to add to PATH is /app/.venv/bin.
ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8009
CMD ["uvicorn", "chat.main:app", "--host", "0.0.0.0", "--port", "8009"]
