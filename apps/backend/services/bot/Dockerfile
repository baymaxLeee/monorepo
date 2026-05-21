FROM python:3.12-slim AS builder

ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

RUN pip install --no-cache-dir uv

WORKDIR /app

# Copy workspace root + this service + libs
COPY apps/backend/pyproject.toml /app/
COPY apps/backend/services/bot /app/services/bot
COPY apps/backend/libs /app/libs

WORKDIR /app/services/bot
RUN uv sync --frozen --no-dev

# ─── runtime ────────────────────────────────────────────
FROM python:3.12-slim
WORKDIR /app
COPY --from=builder /app /app
ENV PATH="/app/services/bot/.venv/bin:$PATH"

EXPOSE 8001
CMD ["uvicorn", "bot.main:app", "--host", "0.0.0.0", "--port", "8001"]
