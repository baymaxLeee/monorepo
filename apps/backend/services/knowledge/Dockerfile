FROM python:3.14.5-slim AS builder

ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

WORKDIR /app
COPY pyproject.toml uv.lock /app/
COPY libs/kernel /app/libs/kernel
COPY services/knowledge/pyproject.toml /app/services/knowledge/pyproject.toml

WORKDIR /app/services/knowledge
RUN uv sync --frozen --no-dev

COPY services/knowledge /app/services/knowledge

FROM python:3.14.5-slim
COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/libs/kernel /app/libs/kernel
COPY --from=builder /app/services/knowledge /app/services/knowledge
ENV PATH="/app/.venv/bin:$PATH"
RUN mkdir -p /data/objects
WORKDIR /app/services/knowledge
EXPOSE 8010
CMD ["uvicorn", "main:app", "--app-dir", "src", "--host", "0.0.0.0", "--port", "8010", "--no-access-log"]
