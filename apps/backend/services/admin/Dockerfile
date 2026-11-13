FROM python:3.14.5-slim AS uv-base
COPY --from=ghcr.io/astral-sh/uv:0.13.6 /uv /uvx /bin/

FROM uv-base AS requirements
WORKDIR /app
COPY pyproject.toml uv.lock /app/
COPY libs/kernel/pyproject.toml /app/libs/kernel/pyproject.toml
COPY services/admin/pyproject.toml /app/services/admin/pyproject.toml
# Export only this service's locked third-party dependencies. Unrelated workspace
# lock changes must not invalidate the large installed dependency layer.
RUN uv export --frozen --package admin --no-dev --no-emit-workspace \
    --no-header --no-annotate --output-file /requirements.txt

FROM uv-base AS dependencies
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
RUN uv venv /app/.venv
RUN --mount=type=bind,from=requirements,source=/requirements.txt,target=/requirements.txt \
    --mount=type=cache,target=/root/.cache/uv \
    uv pip sync --python /app/.venv/bin/python --require-hashes /requirements.txt

FROM uv-base AS kernel-wheel
COPY libs/kernel /kernel
RUN --mount=type=cache,target=/root/.cache/uv \
    uv build /kernel --wheel --out-dir /wheels

FROM python:3.14.5-slim
ENV PATH="/app/.venv/bin:$PATH"
COPY --from=dependencies /app/.venv /app/.venv
# Install kernel in its own small layer; never flatten it and all third-party
# dependencies into a fresh COPY of the complete virtual environment.
RUN --mount=type=bind,from=uv-base,source=/bin/uv,target=/bin/uv \
    --mount=type=bind,from=kernel-wheel,source=/wheels,target=/wheels \
    uv pip install --python /app/.venv/bin/python --no-deps --no-cache /wheels/*.whl
WORKDIR /app/services/admin
COPY services/admin /app/services/admin
EXPOSE 8001
CMD ["uvicorn", "main:app", "--app-dir", "src", "--host", "0.0.0.0", "--port", "8001", "--no-access-log"]
