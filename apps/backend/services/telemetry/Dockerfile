FROM python:3.14.5-slim AS builder

ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

WORKDIR /app

# Build context = apps/backend, so copies are workspace-root-relative.
COPY pyproject.toml uv.lock /app/
COPY libs/kernel /app/libs/kernel
COPY services/telemetry/pyproject.toml /app/services/telemetry/pyproject.toml

WORKDIR /app/services/telemetry
RUN uv sync --frozen --no-dev

COPY services/telemetry /app/services/telemetry

FROM python:3.14.5-slim
COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/libs/kernel /app/libs/kernel
COPY --from=builder /app/services/telemetry /app/services/telemetry
ENV PATH="/app/.venv/bin:$PATH"
WORKDIR /app/services/telemetry

EXPOSE 8008
CMD ["uvicorn", "main:app", "--app-dir", "src", "--host", "0.0.0.0", "--port", "8008", "--no-access-log"]
