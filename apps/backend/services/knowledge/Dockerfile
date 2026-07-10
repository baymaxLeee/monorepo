FROM python:3.14.5-slim AS builder

ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

WORKDIR /app
COPY pyproject.toml uv.lock /app/
COPY services/knowledge /app/services/knowledge
COPY libs /app/libs

WORKDIR /app/services/knowledge
RUN uv sync --frozen --no-dev

FROM python:3.14.5-slim
COPY --from=builder /app /app
ENV PATH="/app/.venv/bin:$PATH"
RUN mkdir -p /data/objects
WORKDIR /app/services/knowledge
EXPOSE 8010
CMD ["uvicorn", "main:app", "--app-dir", "src", "--host", "0.0.0.0", "--port", "8010", "--no-access-log"]
