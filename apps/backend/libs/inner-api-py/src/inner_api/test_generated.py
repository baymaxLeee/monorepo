from importlib import import_module


def test_generated_contracts_and_stubs_are_importable() -> None:
    admin_pb2 = import_module("admin.v1.admin_pb2")
    admin_pb2_grpc = import_module("admin.v1.admin_pb2_grpc")
    canvas_pb2 = import_module("canvas.v1.canvas_pb2")
    context_pb2 = import_module("common.v1.context_pb2")
    knowledge_pb2 = import_module("knowledge.v1.knowledge_pb2")
    knowledge_pb2_grpc = import_module("knowledge.v1.knowledge_pb2_grpc")
    storage_pb2 = import_module("storage.v1.storage_pb2")
    storage_pb2_grpc = import_module("storage.v1.storage_pb2_grpc")

    assert admin_pb2.ModelProvider.DESCRIPTOR.full_name == "admin.v1.ModelProvider"
    assert canvas_pb2.CanvasGraph.DESCRIPTOR.full_name == "canvas.v1.CanvasGraph"
    assert context_pb2.ActorContext.DESCRIPTOR.full_name == "common.v1.ActorContext"
    assert knowledge_pb2.RetrieveRequest.DESCRIPTOR.full_name == "knowledge.v1.RetrieveRequest"
    assert storage_pb2.UploadRequest.DESCRIPTOR.full_name == "storage.v1.UploadRequest"
    assert admin_pb2_grpc.ProviderServiceStub is not None
    assert knowledge_pb2_grpc.RetrievalServiceStub is not None
    assert storage_pb2_grpc.AssetServiceStub is not None
