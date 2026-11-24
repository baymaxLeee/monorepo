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
SINGLE_VPS_RENDER_ENV_PATH = ROOT / "infra" / "single-vps" / "render-env.sh"
SINGLE_VPS_OPERATOR_ENV_EXAMPLE_PATH = ROOT / "infra" / "single-vps" / "secrets.sops.env.example"
GATEWAY_SOURCE_ROOT = ROOT / "apps" / "backend" / "services" / "gateway"
K8S_BASE = ROOT / "infra" / "k8s" / "base"
K8S_NETWORK_POLICY_PATH = K8S_BASE / "network-policy.yaml"
REQUIRED = ("root", "runtime", "port", "publicRoutes", "bindings", "databases")
RUNTIMES = {"go", "python", "node"}
RUNTIME_MARKERS = {"go": "go.mod", "python": "pyproject.toml", "node": "package.json"}
BINDING_TRANSPORTS = {"http", "rpc"}


def fail(message: str) -> None:
    print(f"✗ {message}", file=sys.stderr)
    raise SystemExit(1)


def reject_duplicate_yaml_keys(path: Path, text: str) -> None:
    def visit(node: yaml.Node, location: str) -> None:
        if isinstance(node, yaml.MappingNode):
            seen: set[str] = set()
            for key_node, value_node in node.value:
                if isinstance(key_node, yaml.ScalarNode) and key_node.value != "<<":
                    if key_node.value in seen:
                        fail(f"{path.relative_to(ROOT)} has duplicate key {key_node.value!r} at {location}")
                    seen.add(key_node.value)
                visit(value_node, f"{location}.{getattr(key_node, 'value', '?')}")
        elif isinstance(node, yaml.SequenceNode):
            for index, value in enumerate(node.value):
                visit(value, f"{location}[{index}]")

    for document in yaml.compose_all(text):
        if document is not None:
            visit(document, "$")


def load_yaml(path: Path) -> Any:
    if not path.is_file():
        fail(f"missing {path.relative_to(ROOT)}")
    text = path.read_text()
    reject_duplicate_yaml_keys(path, text)
    return yaml.safe_load(text)


def load_services() -> dict[str, dict[str, Any]]:
    data = load_yaml(SERVICES_PATH)
    if not isinstance(data, dict) or not isinstance(data.get("services"), dict):
        fail("services.yaml must have a top-level services mapping")
    return data["services"]


def validate_schema(services: dict[str, dict[str, Any]]) -> None:
    service_root = ROOT / "apps" / "backend" / "services"
    directories = {path.name for path in service_root.iterdir() if path.is_dir() and not path.name.startswith(".")}
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

        for field in ("publicRoutes", "databases"):
            value = config[field]
            if not isinstance(value, list) or len(value) != len(set(value)):
                fail(f"{service_id}: {field} must be a list without duplicates")

        bindings = config["bindings"]
        if not isinstance(bindings, dict):
            fail(f"{service_id}: bindings must map service ids to transport lists")

        for database in config["databases"]:
            if not isinstance(database, str) or not database:
                fail(f"{service_id}: database names must be non-empty strings")
            if database in database_owners:
                fail(f"database ownership conflict: {database} owned by {database_owners[database]} and {service_id}")
            database_owners[database] = service_id

        for dependency, transports in bindings.items():
            if not isinstance(dependency, str) or not dependency:
                fail(f"{service_id}: binding names must be non-empty strings")
            if dependency not in services:
                fail(f"{service_id}: binding {dependency} is not a declared service")
            if dependency == service_id:
                fail(f"{service_id}: cannot bind to itself")
            if (
                not isinstance(transports, list)
                or not transports
                or len(transports) != len(set(transports))
                or any(transport not in BINDING_TRANSPORTS for transport in transports)
            ):
                fail(
                    f"{service_id}: binding {dependency} transports must be a non-empty unique list from "
                    f"{sorted(BINDING_TRANSPORTS)}"
                )

        for route in config["publicRoutes"]:
            if not isinstance(route, str) or not route.startswith("/"):
                fail(f"{service_id}: invalid public route {route!r}")
            if route != "/*" and route in public_routes:
                fail(f"public route {route} used by {public_routes[route]} and {service_id}")
            public_routes[route] = service_id

        openapi = config.get("openapi")
        if openapi is not None and not (ROOT / openapi).is_file():
            fail(f"{service_id}: openapi path missing: {openapi}")
        expected_openapi_version = config.get("openapiVersion")
        if openapi is None:
            if expected_openapi_version is not None:
                fail(f"{service_id}: openapiVersion requires an openapi artifact")
        else:
            if not isinstance(expected_openapi_version, str):
                fail(f"{service_id}: openapiVersion must be declared as a string")
            document = json.loads((ROOT / openapi).read_text())
            if document.get("openapi") != expected_openapi_version:
                fail(
                    f"{service_id}: openapi version drift: "
                    f"expected={expected_openapi_version} actual={document.get('openapi')}"
                )

    if services["runtime"]["publicRoutes"]:
        fail("runtime must remain internal-only")
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
        expected = {service_id for service_id, config in services.items() if config["runtime"] == runtime}
        if actual != expected:
            fail(f"backend justfile {runtime} services drift: expected={sorted(expected)} actual={sorted(actual)}")

    ports = json.loads(parse_just_assignment(text, "PORTS"))
    expected_ports = {service_id: config["port"] for service_id, config in services.items()}
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

    port_owners: dict[str, str] = {}
    for match in re.finditer(r"(?m)^([^#:\s]+):\s*(.+)$", text):
        label, command = match.groups()
        port_match = re.search(r"(?:^|\s)(?:PORT=(\d+)|--port\s+(\d+))(?:\s|$)", command)
        if not port_match:
            continue
        port = next(value for value in port_match.groups() if value is not None)
        if owner := port_owners.get(port):
            fail(f"Procfile.dev processes {owner} and {label} both own port {port}")
        port_owners[port] = label


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

    dev_urls = ROOT_JUSTFILE_PATH.read_text().split("dev-urls:", 1)[-1].split("# ─── Build", 1)[0]
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


def binding_key(dependency: str, transport: str) -> str:
    suffix = "SERVICE_URL" if transport == "http" else "RPC_TARGET"
    return f"{dependency.upper()}_{suffix}"


def expected_binding_keys(config: dict[str, Any]) -> set[str]:
    return {
        binding_key(dependency, transport)
        for dependency, transports in config["bindings"].items()
        for transport in transports
    }


def binding_environment(values: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in values.items() if key.endswith(("_SERVICE_URL", "_RPC_TARGET"))}


def k8s_workloads(services: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    workloads: dict[str, dict[str, Any]] = {}
    for service_id, config in services.items():
        service_root = K8S_BASE / service_id
        configmaps = {}
        for path in service_root.glob("*configmap.yaml"):
            document = load_yaml(path)
            configmaps[document["metadata"]["name"]] = document.get("data", {})

        for path in service_root.glob("*deployment.yaml"):
            deployment = load_yaml(path)
            name = deployment["metadata"]["name"]
            if name in workloads:
                fail(f"duplicate K8s workload name {name}")
            labels = deployment["spec"]["template"]["metadata"]["labels"]
            environment: dict[str, Any] = {}
            for container in deployment["spec"]["template"]["spec"].get("containers", []):
                for source in container.get("envFrom", []):
                    configmap_name = source.get("configMapRef", {}).get("name")
                    if configmap_name:
                        if configmap_name not in configmaps:
                            fail(f"{name}: referenced K8s ConfigMap {configmap_name} is not declared by {service_id}")
                        environment.update(configmaps[configmap_name])
            bindings = {
                (dependency, transport): environment[binding_key(dependency, transport)]
                for dependency, transports in config["bindings"].items()
                for transport in transports
                if binding_key(dependency, transport) in environment
            }
            workloads[name] = {
                "owner": service_id,
                "labels": labels,
                "bindings": bindings,
                "environment": environment,
                "main": path.name == "deployment.yaml",
            }
    return workloads


def validate_binding_environment(services: dict[str, dict[str, Any]]) -> None:
    compose = load_yaml(SINGLE_VPS_PATH)
    compose_services = compose.get("services") if isinstance(compose, dict) else None
    if not isinstance(compose_services, dict):
        fail("single-vps compose must define services")

    for service_id, config in services.items():
        expected = expected_binding_keys(config)
        local_env = env_from_example(service_id)
        local = {key for key in local_env if key.endswith(("_SERVICE_URL", "_RPC_TARGET"))}
        if local != expected:
            fail(f"{service_id}: .env.example bindings drift: expected={sorted(expected)} actual={sorted(local)}")

        configmap = load_yaml(K8S_BASE / service_id / "configmap.yaml")
        k8s_data = configmap.get("data") if isinstance(configmap, dict) else None
        if not isinstance(k8s_data, dict):
            fail(f"{service_id}: invalid K8s ConfigMap")
        k8s_keys = {key for key in k8s_data if key.endswith(("_SERVICE_URL", "_RPC_TARGET"))}
        if k8s_keys != expected:
            fail(f"{service_id}: K8s bindings drift: expected={sorted(expected)} actual={sorted(k8s_keys)}")

        compose_entry = compose_services.get(service_id)
        compose_env = compose_entry.get("environment") if isinstance(compose_entry, dict) else None
        if not isinstance(compose_env, dict):
            fail(f"{service_id}: single-vps compose environment missing")
        compose_keys = {key for key in compose_env if key.endswith(("_SERVICE_URL", "_RPC_TARGET"))}
        if compose_keys != expected:
            fail(f"{service_id}: single-vps bindings drift: expected={sorted(expected)} actual={sorted(compose_keys)}")

        for dependency, transports in config["bindings"].items():
            target = services[dependency]
            for transport in transports:
                key = binding_key(dependency, transport)
                port = target["port"] if transport == "http" else target.get("rpcPort")
                if port is None:
                    fail(f"{dependency}: services.yaml must declare rpcPort for RPC binding from {service_id}")
                expected_fragment = f"{dependency}:{port}"
                if expected_fragment not in str(k8s_data[key]) or expected_fragment not in str(compose_env[key]):
                    fail(f"{service_id}: {key} must target {expected_fragment} in K8s and single-vps")

        if config["databases"]:
            database_key = "IAM_POSTGRES_DATABASE" if service_id == "iam" else "POSTGRES_DATABASE"
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

    workloads = k8s_workloads(services)
    for workload_name, workload in workloads.items():
        compose_entry = compose_services.get(workload_name)
        if not isinstance(compose_entry, dict):
            continue
        compose_environment = compose_entry.get("environment")
        if not isinstance(compose_environment, dict):
            fail(f"{workload_name}: single-vps compose environment missing")
        k8s_bindings = binding_environment(workload["environment"])
        compose_bindings = binding_environment(compose_environment)
        if set(compose_bindings) != set(k8s_bindings):
            fail(
                f"{workload_name}: single-vps workload bindings drift from K8s: "
                f"expected={sorted(k8s_bindings)} actual={sorted(compose_bindings)}"
            )
        for (dependency, transport), k8s_value in workload["bindings"].items():
            key = binding_key(dependency, transport)
            target = services[dependency]
            port = target["port"] if transport == "http" else target.get("rpcPort")
            expected_fragment = f"{dependency}:{port}"
            if expected_fragment not in str(k8s_value) or expected_fragment not in str(compose_bindings[key]):
                fail(f"{workload_name}: {key} must target {expected_fragment} in K8s and single-vps")


def validate_service_identities(services: dict[str, dict[str, Any]]) -> None:
    chat_token = env_from_example("chat").get("INTERNAL_API_TOKEN", "")
    if not chat_token:
        fail("chat: .env.example must declare INTERNAL_API_TOKEN for the HTTP streaming edge")
    expected = {"chat": chat_token}
    actual = json.loads(env_from_example("runtime").get("INTERNAL_SERVICE_TOKENS", "{}"))
    if actual != expected:
        fail(f"runtime: .env.example HTTP caller map drift: expected={expected} actual={actual}")

    compose_services = load_yaml(SINGLE_VPS_PATH)["services"]
    rpc_consumers = {
        target: {source for source, config in services.items() if "rpc" in config["bindings"].get(target, [])}
        for target in services
    }
    surfaces = {
        ".env.example": {service_id: env_from_example(service_id) for service_id in services},
        "K8s Secret": {
            service_id: load_yaml(K8S_BASE / service_id / "secret.yaml").get("stringData", {})
            for service_id in services
        },
        "single-vps": {service_id: compose_services[service_id]["environment"] for service_id in services},
    }
    for surface, service_environments in surfaces.items():
        outbound_tokens: dict[str, str] = {}
        for service_id, config in services.items():
            if not any("rpc" in transports for transports in config["bindings"].values()):
                continue
            token = service_environments[service_id].get("INTERNAL_API_TOKEN")
            if not isinstance(token, str) or not token:
                fail(f"{service_id}: {surface} must provide INTERNAL_API_TOKEN for outbound RPC")
            outbound_tokens[service_id] = token
        if len(set(outbound_tokens.values())) != len(outbound_tokens):
            fail(f"{surface}: outbound RPC caller credentials must be unique per service")

        for service_id, callers in rpc_consumers.items():
            if not callers:
                continue
            raw_tokens = service_environments[service_id].get("INTERNAL_SERVICE_TOKENS")
            try:
                tokens = json.loads(raw_tokens) if isinstance(raw_tokens, str) else None
            except json.JSONDecodeError:
                tokens = None
            if not isinstance(tokens, dict) or any(
                not isinstance(caller, str) or not isinstance(token, str) or not token
                for caller, token in tokens.items()
            ):
                fail(f"{service_id}: {surface} INTERNAL_SERVICE_TOKENS must be a string-to-string JSON object")
            if set(tokens) != callers:
                fail(
                    f"{service_id}: {surface} RPC caller credentials drift: "
                    f"expected={sorted(callers)} actual={sorted(tokens)}"
                )
            for caller in callers:
                if tokens[caller] != outbound_tokens[caller]:
                    fail(f"{service_id}: {surface} RPC token for {caller} does not match {caller} INTERNAL_API_TOKEN")


def selector_matches(selector: dict[str, Any], labels: dict[str, str]) -> bool:
    for key, value in selector.get("matchLabels", {}).items():
        if labels.get(key) != value:
            return False
    for expression in selector.get("matchExpressions", []):
        key = expression.get("key")
        values = expression.get("values", [])
        operator = expression.get("operator")
        if operator == "In" and labels.get(key) not in values:
            return False
        if operator == "NotIn" and (key not in labels or labels[key] in values):
            return False
        if operator == "Exists" and key not in labels:
            return False
        if operator == "DoesNotExist" and key in labels:
            return False
    return True


def validate_k8s_network_bindings(services: dict[str, dict[str, Any]]) -> None:
    network_policy_text = K8S_NETWORK_POLICY_PATH.read_text()
    reject_duplicate_yaml_keys(K8S_NETWORK_POLICY_PATH, network_policy_text)
    policies = [document for document in yaml.safe_load_all(network_policy_text) if document]
    workloads = k8s_workloads(services)
    main_workloads = {workload["owner"]: name for name, workload in workloads.items() if workload["main"]}
    for source, workload in workloads.items():
        for target, transport in workload["bindings"]:
            target_workload = main_workloads[target]
            expected_port = services[target]["port"] if transport == "http" else services[target].get("rpcPort")
            allowed = False
            for policy in policies:
                spec = policy.get("spec", {})
                if not selector_matches(spec.get("podSelector", {}), workloads[target_workload]["labels"]):
                    continue
                for ingress in spec.get("ingress", []):
                    source_allowed = any(
                        "podSelector" in peer and selector_matches(peer["podSelector"], workload["labels"])
                        for peer in ingress.get("from", [])
                    )
                    ports = ingress.get("ports", [])
                    port_allowed = any(
                        item.get("protocol", "TCP") == "TCP" and item.get("port") in {expected_port, transport}
                        for item in ports
                    )
                    if source_allowed and port_allowed:
                        allowed = True
                        break
                if allowed:
                    break
            if not allowed:
                fail(f"K8s NetworkPolicy missing {source} -> {target_workload} {transport}:{expected_port}")

    allowed_ports: dict[tuple[str, str], set[int | str]] = {}
    for source, workload in workloads.items():
        for target, transport in workload["bindings"]:
            target_workload = main_workloads[target]
            ports = allowed_ports.setdefault((source, target_workload), set())
            ports.add(transport)
            ports.add(services[target]["port"] if transport == "http" else services[target]["rpcPort"])
    for policy in policies:
        spec = policy.get("spec", {})
        selected_targets = [
            target
            for target, workload in workloads.items()
            if selector_matches(spec.get("podSelector", {}), workload["labels"])
        ]
        for ingress in spec.get("ingress", []):
            selected_sources = [
                source
                for source, workload in workloads.items()
                if any(
                    "podSelector" in peer and selector_matches(peer["podSelector"], workload["labels"])
                    for peer in ingress.get("from", [])
                )
            ]
            for source in selected_sources:
                for target in selected_targets:
                    if workloads[source]["owner"] == workloads[target]["owner"]:
                        continue
                    ports = ingress.get("ports")
                    if not ports:
                        fail(f"K8s NetworkPolicy broadly allows all ports for {source} -> {target}")
                    unexpected = {
                        item.get("port")
                        for item in ports
                        if item.get("protocol", "TCP") == "TCP"
                        and item.get("port") not in allowed_ports.get((source, target), set())
                    }
                    if unexpected:
                        fail(
                            f"K8s NetworkPolicy allows undeclared {source} -> {target} ports: "
                            f"{sorted(unexpected, key=str)}"
                        )


def dotenv_keys(path: Path) -> set[str]:
    return {
        match.group(1) for line in path.read_text().splitlines() if (match := re.match(r"^([A-Z][A-Z0-9_]*)=", line))
    }


def validate_single_vps_environment(services: dict[str, dict[str, Any]]) -> None:
    compose_env = load_yaml(SINGLE_VPS_PATH)["services"]["storage"]["environment"]
    if compose_env.get("STORAGE_SIGNING_KEY") != "${STORAGE_SIGNING_KEY:?STORAGE_SIGNING_KEY is required}":
        fail("storage: single-vps must inject required STORAGE_SIGNING_KEY")
    if not load_yaml(K8S_BASE / "storage" / "secret.yaml").get("stringData", {}).get("STORAGE_SIGNING_KEY"):
        fail("storage: K8s Secret must declare STORAGE_SIGNING_KEY")
    render_env = SINGLE_VPS_RENDER_ENV_PATH.read_text()
    internal_match = re.search(r"(?ms)^INTERNAL_KEYS=\(\n(?P<body>.*?)^\)", render_env)
    if not internal_match:
        fail("single-vps render-env.sh missing INTERNAL_KEYS")
    internal_keys = set(re.findall(r"(?m)^\s+([A-Z][A-Z0-9_]*)\s*$", internal_match.group("body")))

    expected_database_keys = {"WORKFLOW_POSTGRES_PASSWORD"}
    expected_database_keys.update(
        f"{service_id.upper().replace('-', '_')}_POSTGRES_PASSWORD"
        for service_id, config in services.items()
        if config["databases"]
    )
    missing_database_keys = expected_database_keys - internal_keys
    if missing_database_keys:
        fail(f"single-vps render-env.sh does not generate database passwords: {sorted(missing_database_keys)}")

    runtime_keys = {"IMAGE_REGISTRY", "IMAGE_TAG", "PUBLIC_PORT", "PUBLIC_GATEWAY_URL"}
    operator_keys = dotenv_keys(SINGLE_VPS_OPERATOR_ENV_EXAMPLE_PATH)
    required_compose_keys = set(re.findall(r"\$\{([A-Z][A-Z0-9_]*):\?", SINGLE_VPS_PATH.read_text()))
    missing_sources = required_compose_keys - runtime_keys - internal_keys - operator_keys
    if missing_sources:
        fail(f"single-vps compose requires variables with no render-env source: {sorted(missing_sources)}")


def validate_k8s_ports(services: dict[str, dict[str, Any]]) -> None:
    for service_id, config in services.items():
        port = config["port"]
        configmap = load_yaml(K8S_BASE / service_id / "configmap.yaml")
        if str(configmap.get("data", {}).get("PORT")) != str(port):
            fail(f"{service_id}: K8s ConfigMap PORT drift")

        deployment = load_yaml(K8S_BASE / service_id / "deployment.yaml")
        containers = deployment.get("spec", {}).get("template", {}).get("spec", {}).get("containers", [])
        container = next((item for item in containers if item.get("name") == service_id), None)
        container_ports = container.get("ports", []) if isinstance(container, dict) else []
        if not any(item.get("containerPort") == port for item in container_ports):
            fail(f"{service_id}: K8s Deployment containerPort drift")

        service = load_yaml(K8S_BASE / service_id / "service.yaml")
        service_ports = service.get("spec", {}).get("ports", [])
        if not any(item.get("port") == port for item in service_ports):
            fail(f"{service_id}: K8s Service port drift")


def validate_gateway_routes(services: dict[str, dict[str, Any]]) -> None:
    source = "\n".join(
        path.read_text() for path in GATEWAY_SOURCE_ROOT.rglob("*.go") if not path.name.endswith("_test.go")
    )
    gateway_bindings = set(services["gateway"]["bindings"])
    expected_public = {
        service_id for service_id, config in services.items() if service_id != "gateway" and config["publicRoutes"]
    }
    if gateway_bindings != expected_public:
        fail(
            "gateway bindings must equal publicly routed backend services: "
            f"bindings={sorted(gateway_bindings)} public={sorted(expected_public)}"
        )
    for service_id in expected_public:
        for route in services[service_id]["publicRoutes"]:
            prefix = route.removesuffix("/*")
            direct_mount = re.search(rf'\.Mount\(\s*"{re.escape(prefix)}"', source)
            route_table = re.search(rf'\{{\s*"{re.escape(prefix)}"\s*,', source)
            if not direct_mount and not route_table:
                fail(f"gateway source missing public route {route} for {service_id}")


def main() -> None:
    services = load_services()
    validate_schema(services)
    validate_backend_justfile(services)
    validate_procfile(services)
    validate_dev_entrypoints(services)
    validate_binding_environment(services)
    validate_service_identities(services)
    validate_k8s_network_bindings(services)
    validate_single_vps_environment(services)
    validate_k8s_ports(services)
    validate_gateway_routes(services)
    print(
        f"✓ services.yaml matches justfile, Procfile, bindings, gateway, K8s, and single-vps ({len(services)} services)"
    )


if __name__ == "__main__":
    main()
