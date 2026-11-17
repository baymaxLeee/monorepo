from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class Bot(_message.Message):
    __slots__ = ("id", "name", "status", "created_at")
    class Status(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        STATUS_UNSPECIFIED: _ClassVar[Bot.Status]
        STATUS_DRAFT: _ClassVar[Bot.Status]
        STATUS_PUBLISHED: _ClassVar[Bot.Status]
        STATUS_ARCHIVED: _ClassVar[Bot.Status]
    STATUS_UNSPECIFIED: Bot.Status
    STATUS_DRAFT: Bot.Status
    STATUS_PUBLISHED: Bot.Status
    STATUS_ARCHIVED: Bot.Status
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    status: Bot.Status
    created_at: str
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ..., status: _Optional[_Union[Bot.Status, str]] = ..., created_at: _Optional[str] = ...) -> None: ...

class GetBotRequest(_message.Message):
    __slots__ = ("id",)
    ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    def __init__(self, id: _Optional[str] = ...) -> None: ...

class GetBotResponse(_message.Message):
    __slots__ = ("bot",)
    BOT_FIELD_NUMBER: _ClassVar[int]
    bot: Bot
    def __init__(self, bot: _Optional[_Union[Bot, _Mapping]] = ...) -> None: ...

class ListBotsRequest(_message.Message):
    __slots__ = ("page_size", "page_token")
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    page_size: int
    page_token: str
    def __init__(self, page_size: _Optional[int] = ..., page_token: _Optional[str] = ...) -> None: ...

class ListBotsResponse(_message.Message):
    __slots__ = ("bots", "next_page_token")
    BOTS_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    bots: _containers.RepeatedCompositeFieldContainer[Bot]
    next_page_token: str
    def __init__(self, bots: _Optional[_Iterable[_Union[Bot, _Mapping]]] = ..., next_page_token: _Optional[str] = ...) -> None: ...
