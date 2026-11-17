from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import admin.v1.admin_pb2 as admin_pb2
import admin.v1.admin_pb2_grpc as admin_pb2_grpc
import grpc
import pytest
from bootstrap.config import Settings
from google.protobuf import struct_pb2

from application.admin_client import AdminClient, ProviderNotConfiguredError


class ProviderService(admin_pb2_grpc.ProviderServiceServicer):
    def __init__(self, *, missing: bool = False) -> None:
        self.missing = missing
        self.metadata: dict[str, str] = {}

    async def GetProvider(self, request, context):  # type: ignore[no-untyped-def]
        self.metadata = dict(context.invocation_metadata())
        if self.missing:
            await context.abort(grpc.StatusCode.NOT_FOUND, "provider not found")
        return admin_pb2.GetProviderResponse(
            provider=admin_pb2.ModelProvider(
                id=request.provider_id,
                user_id="user-1",
                name="Vision",
                model="vision-model",
                provider_kind=admin_pb2.PROVIDER_KIND_CHAT,
                base_url="https://provider.example/v1",
                api_key="secret",
                extra_body=struct_pb2.Struct(),
                context_window=128000,
                max_output_tokens=4096,
                supports_image_input=True,
                is_default=True,
                is_enabled=True,
            )
        )

    async def GetTaskProvider(self, request, context):  # type: ignore[no-untyped-def]
        await context.abort(grpc.StatusCode.UNIMPLEMENTED, "not used by this test")

    async def GetDefaultProvider(self, request, context):  # type: ignore[no-untyped-def]
        await context.abort(grpc.StatusCode.UNIMPLEMENTED, "not used by this test")

    async def GetProviderByKind(self, request, context):  # type: ignore[no-untyped-def]
        await context.abort(grpc.StatusCode.UNIMPLEMENTED, "not used by this test")

    async def ListProviderCatalog(self, request, context):  # type: ignore[no-untyped-def]
        await context.abort(grpc.StatusCode.UNIMPLEMENTED, "not used by this test")


@asynccontextmanager
async def client_for(service: ProviderService) -> AsyncIterator[AdminClient]:
    server = grpc.aio.server()
    admin_pb2_grpc.add_ProviderServiceServicer_to_server(service, server)
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    client = AdminClient(Settings(admin_rpc_target=f"127.0.0.1:{port}"))
    try:
        yield client
    finally:
        await client.aclose()
        await server.stop(None)


@pytest.mark.asyncio
async def test_get_provider_uses_typed_rpc_and_maps_snapshot() -> None:
    service = ProviderService()
    async with client_for(service) as client:
        provider = await client.get_provider(workspace_id="workspace-1", tenant_id="tenant-1", provider_id="provider-1")
    assert provider.id == "provider-1"
    assert provider.supports_image_input is True
    assert service.metadata["x-caller-service"] == "knowledge"


@pytest.mark.asyncio
async def test_missing_provider_preserves_domain_error() -> None:
    async with client_for(ProviderService(missing=True)) as client:
        with pytest.raises(ProviderNotConfiguredError):
            await client.get_provider(workspace_id="workspace-1", tenant_id="tenant-1", provider_id="missing")
