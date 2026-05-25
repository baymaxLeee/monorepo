FROM python:3.12-slim AS builder

ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

RUN pip install --no-cache-dir uv

WORKDIR /app

COPY apps/backend/pyproject.toml /app/
COPY apps/backend/services/telemetry /app/services/telemetry
COPY apps/backend/libs /app/libs

WORKDIR /app/services/telemetry
RUN uv sync --frozen --no-dev

FROM python:3.12-slim
WORKDIR /app
COPY --from=builder /app /app
ENV PATH="/app/services/telemetry/.venv/bin:$PATH"

EXPOSE 8008
CMD ["uvicorn", "telemetry.main:app", "--host", "0.0.0.0", "--port", "8008"]
