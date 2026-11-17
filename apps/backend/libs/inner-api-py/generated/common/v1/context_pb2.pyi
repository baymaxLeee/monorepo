from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class ActorContext(_message.Message):
    __slots__ = ("user_id", "tenant_id", "workspace_id")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    TENANT_ID_FIELD_NUMBER: _ClassVar[int]
    WORKSPACE_ID_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    tenant_id: str
    workspace_id: str
    def __init__(self, user_id: _Optional[str] = ..., tenant_id: _Optional[str] = ..., workspace_id: _Optional[str] = ...) -> None: ...
