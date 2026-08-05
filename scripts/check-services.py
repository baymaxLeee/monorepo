#!/usr/bin/env python3
"""Validate services.yaml against local, Single-VPS, and Kubernetes surfaces."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent.parent
SERVICES_PATH = ROOT / "services.yaml"
PROCFILE_PATH = ROOT / "Procfile.dev"
BACKEND_JUSTFILE_PATH = ROOT / "apps" / "backend" / "justfile"
ROOT_JUSTFILE_PATH = ROOT / "justfile"
DEV_PREFLIGHT_PATH = ROOT / "scripts" / "dev-preflight.sh"
SINGLE_VPS_PATH = ROOT / "infra" / "single-vps" / "docker-compose.prod.yml"
GATEWAY_MAIN_PATH = (
    ROOT / "apps" / "backend" / "services" / "gateway" / "cmd" / "server" / "main.go"
)
K8S_BASE = ROOT / "infra" / "k8s" / "base"
REQUIRED = ("root", "runtime", "port", "publicRoutes", "bindings", "databases")
RUNTIMES = {"go", "python", "node"}
RUNTIME_MARKERS = {"go": "go.mod", "python": "pyproject.toml", "node": "package.json"}


def fail(message: str) -> None:
    print(f"✗ {message}", file=sys.stderr)
    raise SystemExit(1)


def load_yaml(path: Path) -> Any:
    if not path.is_file():
        fail(f"missing {path.relative_to(ROOT)}")
    return yaml.safe_load(path.read_text())


def load_services() -> dict[str, dict[str, Any]]:
    data = load_yaml(SERVICES_PATH)
    if not isinstance(data, dict) or not isinstance(data.get("services"), dict):
        fail("services.yaml must have a top-level services mapping")
    return data["services"]


def validate_schema(services: dict[str, dict[str, Any]]) -> None:
    service_root = ROOT / "apps" / "backend" / "services"
    directories = {
        path.name
        for path in service_root.iterdir()
        if path.is_dir() and not path.name.startswith(".")
    }
    if directories != set(services):
        fail(
            "services.yaml service ids drift from apps/backend/services: "
            f"declared={sorted(services)} directories={sorted(directories)}"
        )

    ports: dict[int, str] = {}
    public_routes: dict[str, str] = {}
    database_owners: dict[str, str] = {}
    for service_id, config in services.items():
        if not isinstance(config, dict):
            fail(f"{service_id}: must be a mapping")
        for key in REQUIRED:
            if key not in config:
                fail(f"{service_id}: missing field {key}")

        root = ROOT / config["root"]
        if not root.is_dir() or root.name != service_id:
            fail(f"{service_id}: invalid root {config['root']}")
        runtime = config["runtime"]
        if runtime not in RUNTIMES:
            fail(f"{service_id}: runtime must be one of {sorted(RUNTIMES)}")
        if not (root / RUNTIME_MARKERS[runtime]).is_file():
            fail(f"{service_id}: root does not contain {RUNTIME_MARKERS[runtime]}")

        port = config["port"]
        if not isinstance(port, int) or port < 1:
            fail(f"{service_id}: port must be a positive int")
        if port in ports:
            fail(f"port conflict: {port} used by {ports[port]} and {service_id}")
        ports[port] = service_id

        for field in ("publicRoutes", "bindings", "databases"):
            value = config[field]
            if not isinstance(value, list) or len(value) != len(set(value)):
                fail(f"{service_id}: {field} must be a list without duplicates")

        for database in config["databases"]:
            if not isinstance(database, str) or not database:
                fail(f"{service_id}: database names must be non-empty strings")
            if database in database_owners:
                fail(
                    f"database ownership conflict: {database} owned by "
                    f"{database_owners[database]} and {service_id}"
                )
            database_owners[database] = service_id

        for dependency in config["bindings"]:
            if dependency not in services:
                fail(f"{service_id}: binding {dependency} is not a declared service")
            if dependency == service_id:
                fail(f"{service_id}: cannot bind to itself")

        for route in config["publicRoutes"]:
            if not isinstance(route, str) or not route.startswith("/"):
                fail(f"{service_id}: invalid public route {route!r}")
            if route != "/*" and route in public_routes:
                fail(
                    f"public route {route} used by {public_routes[route]} and {service_id}"
                )
            public_routes[route] = service_id

        openapi = config.get("openapi")
        if openapi is not None and not (ROOT / openapi).is_file():
            fail(f"{service_id}: openapi path missing: {openapi}")

    if services["executor"]["publicRoutes"]:
        fail("executor must remain internal-only")
    if services["gateway"]["publicRoutes"] != ["/*"]:
        fail("gateway must be the sole catch-all public edge")


def parse_just_assignment(text: str, name: str) -> str:
    match = re.search(rf"""(?m)^{re.escape(name)}\s*:=\s*["'](.+)["']$""", text)
    if not match:
        fail(f"apps/backend/justfile missing {name}")
    return match.group(1)


def validate_backend_justfile(services: dict[str, dict[str, Any]]) -> None:
    text = BACKEND_JUSTFILE_PATH.read_text()
    groups = {
        "python": set(parse_just_assignment(text, "PY_SERVICES").split()),
        "node": set(parse_just_assignment(text, "NODE_SERVICES").split()),
        "go": set(parse_just_assignment(text, "GO_SERVICES").split()),
    }
    for runtime, actual in groups.items():
        expected = {
            service_id
            for service_id, config in services.items()
            if config["runtime"] == runtime
        }
        if actual != expected:
            fail(
                f"backend justfile {runtime} services drift: expected={sorted(expected)} actual={sorted(actual)}"
            )

    ports = json.loads(parse_just_assignment(text, "PORTS"))
    expected_ports = {
        service_id: config["port"] for service_id, config in services.items()
    }
    if ports != expected_ports:
        fail(f"backend justfile PORTS drift: expected={expected_ports} actual={ports}")


def procfile_command(text: str, service_id: str) -> str:
    for label in (service_id, f"svc-{service_id}", f"{service_id}-server"):
        match = re.search(rf"(?m)^{re.escape(label)}:\s*(.+)$", text)
        if match:
            return match.group(1)
    fail(f"Procfile.dev missing process for {service_id}")


def validate_procfile(services: dict[str, dict[str, Any]]) -> None:
    text = PROCFILE_PATH.read_text()
    for service_id, config in services.items():
        command = procfile_command(text, service_id)
        port = str(config["port"])
        if not re.search(rf"(?:PORT=|--port\s+){re.escape(port)}(?:\s|$)", command):
            fail(f"Procfile.dev process {service_id} does not own port {port}")


def validate_dev_entrypoints(services: dict[str, dict[str, Any]]) -> None:
    preflight = DEV_PREFLIGHT_PATH.read_text()
    match = re.search(r"DEV_PORTS=\(([^)]*)\)", preflight)
    if not match:
        fail("scripts/dev-preflight.sh missing DEV_PORTS")
    guarded_ports = {int(value) for value in match.group(1).split()}
    backend_ports = {config["port"] for config in services.values()}
    missing = backend_ports - guarded_ports
    if missing:
        fail(f"scripts/dev-preflight.sh missing backend ports: {sorted(missing)}")

    dev_urls = (
        ROOT_JUSTFILE_PATH.read_text()
        .split("dev-urls:", 1)[-1]
        .split("# ─── Build", 1)[0]
    )
    for service_id, config in services.items():
        if f":{config['port']}" not in dev_urls:
            fail(f"root justfile dev-urls missing {service_id}:{config['port']}")


def env_from_example(service_id: str) -> dict[str, str]:
    path = ROOT / "apps" / "backend" / "services" / service_id / ".env.example"
    values: dict[str, str] = {}
    for line in path.read_text().splitlines():
        match = re.match(r"^([A-Z][A-Z0-9_]*)=(.*)$", line)
        if match:
            values[match.group(1)] = match.group(2)
    return values


def expected_binding_keys(config: dict[str, Any]) -> set[str]:
    return {f"{dependency.upper()}_SERVICE_URL" for dependency in config["bindings"]}


def validate_binding_environment(services: dict[str, dict[str, Any]]) -> None:
    compose = load_yaml(SINGLE_VPS_PATH)
    compose_services = compose.get("services") if isinstance(compose, dict) else None
    if not isinstance(compose_services, dict):
        fail("single-vps compose must define services")

    for service_id, config in services.items():
        expected = expected_binding_keys(config)
        local_env = env_from_example(service_id)
        local = {key for key in local_env if key.endswith("_SERVICE_URL")}
        if local != expected:
            fail(
                f"{service_id}: .env.example bindings drift: expected={sorted(expected)} actual={sorted(local)}"
            )

        configmap = load_yaml(K8S_BASE / service_id / "configmap.yaml")
        k8s_data = configmap.get("data") if isinstance(configmap, dict) else None
        if not isinstance(k8s_data, dict):
            fail(f"{service_id}: invalid K8s ConfigMap")
        k8s_keys = {key for key in k8s_data if key.endswith("_SERVICE_URL")}
        if k8s_keys != expected:
            fail(
                f"{service_id}: K8s bindings drift: expected={sorted(expected)} actual={sorted(k8s_keys)}"
            )

        compose_entry = compose_services.get(service_id)
        compose_env = (
            compose_entry.get("environment")
            if isinstance(compose_entry, dict)
            else None
        )
        if not isinstance(compose_env, dict):
            fail(f"{service_id}: single-vps compose environment missing")
        compose_keys = {key for key in compose_env if key.endswith("_SERVICE_URL")}
        if compose_keys != expected:
            fail(
                f"{service_id}: single-vps bindings drift: expected={sorted(expected)} actual={sorted(compose_keys)}"
            )

        for dependency in config["bindings"]:
            key = f"{dependency.upper()}_SERVICE_URL"
            target = services[dependency]
            expected_fragment = f"{dependency}:{target['port']}"
            if expected_fragment not in str(
                k8s_data[key]
            ) or expected_fragment not in str(compose_env[key]):
                fail(
                    f"{service_id}: {key} must target {expected_fragment} in K8s and single-vps"
                )

        if config["databases"]:
            database_key = (
                "IAM_POSTGRES_DATABASE" if service_id == "iam" else "POSTGRES_DATABASE"
            )
            primary_database = config["databases"][0]
            actual_databases = {
                ".env.example": local_env.get(database_key),
                "K8s ConfigMap": k8s_data.get(database_key),
                "single-vps": compose_env.get(database_key),
            }
            for surface, actual in actual_databases.items():
                if str(actual) != primary_database:
                    fail(
                        f"{service_id}: {surface} {database_key} must equal owned primary database "
                        f"{primary_database}, got {actual}"
                    )


def validate_k8s_ports(services: dict[str, dict[str, Any]]) -> None:
    for service_id, config in services.items():
        port = config["port"]
        configmap = load_yaml(K8S_BASE / service_id / "configmap.yaml")
        if str(configmap.get("data", {}).get("PORT")) != str(port):
            fail(f"{service_id}: K8s ConfigMap PORT drift")

        deployment = load_yaml(K8S_BASE / service_id / "deployment.yaml")
        containers = (
            deployment.get("spec", {})
            .get("template", {})
            .get("spec", {})
            .get("containers", [])
        )
        container = next(
            (item for item in containers if item.get("name") == service_id), None
        )
        container_ports = (
            container.get("ports", []) if isinstance(container, dict) else []
        )
        if not any(item.get("containerPort") == port for item in container_ports):
            fail(f"{service_id}: K8s Deployment containerPort drift")

        service = load_yaml(K8S_BASE / service_id / "service.yaml")
        service_ports = service.get("spec", {}).get("ports", [])
        if not any(item.get("port") == port for item in service_ports):
            fail(f"{service_id}: K8s Service port drift")


def validate_gateway_routes(services: dict[str, dict[str, Any]]) -> None:
    source = GATEWAY_MAIN_PATH.read_text()
    gateway_bindings = set(services["gateway"]["bindings"])
    expected_public = {
        service_id
        for service_id, config in services.items()
        if service_id != "gateway" and config["publicRoutes"]
    }
    if gateway_bindings != expected_public:
        fail(
            "gateway bindings must equal publicly routed backend services: "
            f"bindings={sorted(gateway_bindings)} public={sorted(expected_public)}"
        )
    for service_id in expected_public:
        for route in services[service_id]["publicRoutes"]:
            prefix = route.removesuffix("/*")
            if f'r.Mount("{prefix}"' not in source:
                fail(f"gateway source missing public route {route} for {service_id}")


def main() -> None:
    services = load_services()
    validate_schema(services)
    validate_backend_justfile(services)
    validate_procfile(services)
    validate_dev_entrypoints(services)
    validate_binding_environment(services)
    validate_k8s_ports(services)
    validate_gateway_routes(services)
    print(
        f"✓ services.yaml matches justfile, Procfile, bindings, gateway, K8s, and single-vps ({len(services)} services)"
    )


if __name__ == "__main__":
    main()
