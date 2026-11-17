FROM python:3.14.5-slim AS uv-base
COPY --from=ghcr.io/astral-sh/uv:0.13.6 /uv /uvx /bin/

FROM uv-base AS requirements
WORKDIR /app
COPY pyproject.toml uv.lock /app/
COPY services/knowledge/pyproject.toml /app/services/knowledge/pyproject.toml
# Export only this service's locked third-party dependencies. Unrelated workspace
# lock changes must not invalidate the large installed dependency layer.
RUN uv export --frozen --package knowledge --no-dev --no-emit-workspace \
    --no-header --no-annotate --output-file /requirements.txt

FROM uv-base AS dependencies
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
RUN uv venv /app/.venv
RUN --mount=type=bind,from=requirements,source=/requirements.txt,target=/requirements.txt \
    --mount=type=cache,target=/root/.cache/uv \
    uv pip sync --python /app/.venv/bin/python --require-hashes /requirements.txt
COPY libs/inner-api-py /tmp/inner-api-py
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --python /app/.venv/bin/python --no-deps /tmp/inner-api-py

FROM python:3.14.5-slim
ENV PATH="/app/.venv/bin:$PATH"
COPY --from=dependencies /app/.venv /app/.venv
RUN mkdir -p /data/objects
WORKDIR /app/services/knowledge
COPY services/knowledge /app/services/knowledge
EXPOSE 8010 9010
CMD ["uvicorn", "main:app", "--app-dir", "src", "--host", "0.0.0.0", "--port", "8010", "--no-access-log"]
