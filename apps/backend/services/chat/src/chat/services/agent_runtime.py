"""OpenAI-compatible agent runtime for conversation documents."""

from __future__ import annotations

import asyncio
import html as html_lib
import re
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast

from kernel.errors import BaseError, RequestError
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from chat.config import get_settings
from chat.crud import conversations as conversation_crud
from chat.crud import messages as message_crud
from chat.deps import AuthContext
from chat.models.document import ConversationDocumentRow
from chat.models.message import MessageRow
from chat.schemas.agent import ReasoningEffort
from chat.services.admin_client import ProviderSnapshot
from chat.services.agent_tools import (
    agent_runtime_tool_specs,
    execute_agent_runtime_tool,
    is_successful_artifact_write,
)
from chat.services.documents import (
    ConversationDocumentService,
    document_to_schema,
    with_document_refs,
)
from chat.services.model_limits import bounded_extra_body_and_max_tokens

_ARTIFACT_BLOCK_RE = re.compile(r"(?is)<artifact\s+([^>]*)>(.*?)</artifact>")
_ARTIFACT_ATTR_RE = re.compile(r"""(\w+)=(["'])(.*?)\2""")


@dataclass
class ConversationAgentContext:
    session: AsyncSession
    current_user: AuthContext
    conversation_id: str
    documents: dict[str, ConversationDocumentRow]
    selected_documents: list[ConversationDocumentRow]
    messages: list[MessageRow]
    multimodal_provider: ProviderSnapshot | None = None
    created_documents: list[ConversationDocumentRow] = field(default_factory=list)
    pending_artifacts: dict[str, dict[str, Any]] = field(default_factory=dict)

    def get_document(self, document_id: str) -> ConversationDocumentRow:
        if document_id in self.documents:
            return self.documents[document_id]
        for row in self.created_documents:
            if row.id == document_id:
                return row
        raise RequestError(
            "conversation document not found",
            details={"document_id": document_id, "available": list(self.documents.keys())},
        )


class AgentRuntimeError(BaseError):
    status_code = 502
    code = "agent_runtime_failed"


type AgentRunStreamEvent = dict[str, Any]


class AgentRunService:
    def __init__(
        self,
        session: AsyncSession,
        current_user: AuthContext,
        provider: ProviderSnapshot,
        multimodal_provider: ProviderSnapshot | None = None,
    ) -> None:
        self._session = session
        self._current_user = current_user
        self._provider = provider
        self._multimodal_provider = multimodal_provider
        self._settings = get_settings()

    async def stream_run(
        self,
        *,
        conversation_id: str,
        prompt: str,
        document_ids: list[str],
        thinking: bool | None = None,
        reasoning_effort: ReasoningEffort | None = None,
    ) -> AsyncIterator[AgentRunStreamEvent]:
        if not prompt.strip():
            raise RequestError("agent prompt is required")
        context, selected_document_rows = await self._prepare_context(conversation_id, document_ids)

        steps: list[str] = []
        emitted_card_document_ids: set[str] = set()
        partial_message_parts: list[str] = []

        event = self._step_event("已接收任务 正在准备上下文")
        steps.append(str(event["text"]))
        yield event
        if context.messages:
            event = self._step_event(f"已加载 {len(context.messages)} 条历史消息")
            steps.append(str(event["text"]))
            yield event
        if context.documents:
            event = self._step_event(f"已加载 {len(context.documents)} 个会话文档")
            steps.append(str(event["text"]))
            yield event

        await self._persist_user_message(conversation_id, prompt, selected_document_rows)

        try:
            async with asyncio.timeout(self._settings.agent_run_timeout_seconds):
                async for event in self._run_tool_loop(
                    conversation_id=conversation_id,
                    prompt=prompt,
                    context=context,
                    thinking=thinking,
                    reasoning_effort=reasoning_effort,
                ):
                    if event.get("type") == "step":
                        step_text = str(event.get("text") or "")
                        if step_text:
                            steps.append(step_text)
                    elif event.get("type") == "message":
                        delta = event.get("delta")
                        if isinstance(delta, str):
                            partial_message_parts.append(delta)
                    elif event.get("type") == "card":
                        card = event.get("card")
                        if isinstance(card, dict):
                            document = card.get("document")
                            if isinstance(document, dict):
                                document_id = document.get("id")
                                if isinstance(document_id, str) and document_id:
                                    emitted_card_document_ids.add(document_id)
                    yield event
        except TimeoutError as exc:
            await self._persist_failed_assistant_message(
                conversation_id=conversation_id,
                message="agent run timed out",
                created_documents=context.created_documents,
                steps=steps,
                partial_summary="".join(partial_message_parts).strip(),
            )
            raise AgentRuntimeError(
                "agent run timed out",
                details={
                    "provider": self._provider.name,
                    "timeout_seconds": self._settings.agent_run_timeout_seconds,
                },
            ) from exc
        except Exception as exc:
            await self._persist_failed_assistant_message(
                conversation_id=conversation_id,
                message=str(exc),
                created_documents=context.created_documents,
                steps=steps,
                partial_summary="".join(partial_message_parts).strip(),
            )
            raise AgentRuntimeError(
                "agent run failed",
                details={"provider": self._provider.name, "reason": str(exc)},
            ) from exc

        raw_message = "".join(partial_message_parts).strip()
        final_summary = raw_message
        final_summary = await self._materialize_artifact_blocks(
            conversation_id=conversation_id,
            context=context,
            message=final_summary,
        )
        await self._persist_assistant_message(
            conversation_id=conversation_id,
            message=final_summary,
            created_documents=context.created_documents,
            steps=steps,
        )

        if context.created_documents:
            for row in context.created_documents:
                if row.id in emitted_card_document_ids:
                    continue
                emitted_card_document_ids.add(row.id)
                yield self._artifact_card_event(row)

        yield self._message_event(
            text=final_summary,
            status="completed",
        )

    async def _prepare_context(
        self,
        conversation_id: str,
        document_ids: list[str],
    ) -> tuple[ConversationAgentContext, list[ConversationDocumentRow]]:
        conversation = await conversation_crud.get_conversation(
            self._session,
            conversation_id,
            self._current_user.user_id,
            self._current_user.is_admin,
        )
        if conversation is None:
            from kernel.errors import NotFoundError

            raise NotFoundError(f"conversation {conversation_id} not found")

        document_service = ConversationDocumentService(self._session, self._current_user)
        selected_document_rows = await document_service.get_rows(conversation_id, document_ids)
        all_document_rows = await document_service.list_rows(conversation_id)
        message_rows = await message_crud.list_messages(self._session, conversation_id)
        context = ConversationAgentContext(
            session=self._session,
            current_user=self._current_user,
            conversation_id=conversation_id,
            documents={row.id: row for row in all_document_rows},
            selected_documents=list(selected_document_rows),
            messages=message_rows,
            multimodal_provider=self._multimodal_provider,
        )

        if conversation.provider_id != self._provider.id or conversation.model != self._provider.model:
            conversation.provider_id = self._provider.id
            conversation.model = self._provider.model

        return context, list(selected_document_rows)

    async def _persist_user_message(
        self,
        conversation_id: str,
        prompt: str,
        document_rows: Sequence[ConversationDocumentRow],
    ) -> None:
        await message_crud.create_message(
            self._session,
            conversation_id=conversation_id,
            role="user",
            content=with_document_refs(prompt, document_rows),
            status="ok",
        )

    async def _persist_assistant_message(
        self,
        *,
        conversation_id: str,
        message: str,
        created_documents: Sequence[ConversationDocumentRow],
        steps: Sequence[str],
        status: str = "ok",
    ) -> None:
        assistant_text = self._assistant_summary(message, created_documents)
        assistant_content = self._assistant_content(
            steps=steps,
            summary=assistant_text,
            created_documents=created_documents,
        )
        await message_crud.create_message(
            self._session,
            conversation_id=conversation_id,
            role="assistant",
            content=assistant_content,
            status=status,
        )
        conversation = await conversation_crud.get_conversation(
            self._session,
            conversation_id,
            self._current_user.user_id,
            self._current_user.is_admin,
        )
        if conversation is not None:
            await conversation_crud.touch_conversation(self._session, conversation)

    async def _persist_failed_assistant_message(
        self,
        *,
        conversation_id: str,
        message: str,
        created_documents: Sequence[ConversationDocumentRow],
        steps: Sequence[str],
        partial_summary: str,
    ) -> None:
        summary = partial_summary or f"[agent] 运行失败: {message}"
        try:
            await self._persist_assistant_message(
                conversation_id=conversation_id,
                message=summary,
                created_documents=created_documents,
                steps=steps,
                status="failed",
            )
        except Exception:
            await self._session.rollback()

    async def _run_tool_loop(
        self,
        *,
        conversation_id: str,
        prompt: str,
        context: ConversationAgentContext,
        thinking: bool | None,
        reasoning_effort: ReasoningEffort | None,
    ) -> AsyncIterator[AgentRunStreamEvent]:
        client = AsyncOpenAI(
            api_key=self._provider.api_key,
            base_url=self._provider.base_url,
            timeout=self._settings.llm_timeout_seconds,
        )
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": self._instructions()},
            {
                "role": "user",
                "content": self._build_input(
                    prompt=prompt,
                    messages=context.messages,
                    documents=list(context.documents.values()),
                    selected_documents=context.selected_documents,
                ),
            },
        ]
        extra_body, max_tokens = self._model_params(
            thinking=thinking,
            reasoning_effort=reasoning_effort,
        )
        tools = agent_runtime_tool_specs()
        web_search_failures = 0
        try:
            for turn_index in range(self._settings.agent_max_turns):
                yield self._step_event("正在调用模型", status="running")
                stream = await client.chat.completions.create(
                    model=self._provider.model,
                    messages=cast(Any, messages),
                    tools=cast(Any, tools),
                    tool_choice="auto",
                    parallel_tool_calls=False,
                    stream=True,
                    max_tokens=max_tokens,
                    extra_body=extra_body or None,
                )

                content_parts: list[str] = []
                tool_calls = self._empty_tool_call_buffers()
                async for chunk in stream:
                    if not chunk.choices:
                        continue
                    delta = chunk.choices[0].delta
                    content = delta.content
                    if content:
                        content_parts.append(content)
                        yield self._message_event(delta=content)
                    self._merge_tool_call_deltas(tool_calls, getattr(delta, "tool_calls", None))

                yield self._step_event("模型响应完成")

                assistant_content = "".join(content_parts)
                ordered_tool_calls = self._ordered_tool_calls(tool_calls, turn_index=turn_index)
                if not ordered_tool_calls:
                    if not assistant_content.strip():
                        raise AgentRuntimeError(
                            "model returned no final content",
                            details={"provider": self._provider.name, "conversation_id": conversation_id},
                        )
                    return

                messages.append(
                    {
                        "role": "assistant",
                        "content": assistant_content or None,
                        "tool_calls": ordered_tool_calls,
                    }
                )
                for tool_call in ordered_tool_calls:
                    function = tool_call["function"]
                    tool_name = str(function["name"])
                    raw_arguments = str(function.get("arguments") or "{}")
                    yield self._step_event(
                        f"正在调用工具: {tool_name}",
                        status="running",
                        tool_name=tool_name,
                    )
                    if tool_name == "web_search" and web_search_failures >= 2:
                        output = (
                            "Tool error in web_search: web search is unavailable after repeated failures. "
                            "Do not call web_search again; answer from existing knowledge."
                        )
                    else:
                        created_documents_before = len(context.created_documents)
                        output = await execute_agent_runtime_tool(context, tool_name, raw_arguments)
                        if (
                            tool_name in {"write_artifacts", "write_artifact", "finish_artifact"}
                            and "invalid JSON arguments" in output
                        ):
                            recovered = await self._recover_artifacts_from_assistant_content(
                                conversation_id=conversation_id,
                                context=context,
                                assistant_content=assistant_content,
                            )
                            if recovered is not None:
                                output = recovered
                        if tool_name == "web_search" and output.startswith("Tool error in web_search"):
                            web_search_failures += 1
                    yield self._step_event(
                        f"工具执行完成: {tool_name}",
                        tool_name=tool_name,
                        output_preview=output,
                    )
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": str(tool_call["id"]),
                            "content": output,
                        }
                    )
                    if is_successful_artifact_write(tool_name, output):
                        for row in context.created_documents[created_documents_before:]:
                            yield self._artifact_card_event(row)
                        return
        finally:
            await client.close()
        raise AgentRuntimeError(
            "agent max turns exceeded",
            details={
                "provider": self._provider.name,
                "conversation_id": conversation_id,
                "max_turns": self._settings.agent_max_turns,
            },
        )

    @staticmethod
    def _empty_tool_call_buffers() -> dict[int, dict[str, Any]]:
        return {}

    @staticmethod
    def _merge_tool_call_deltas(
        tool_calls: dict[int, dict[str, Any]],
        deltas: Any,
    ) -> None:
        if not deltas:
            return
        for delta in deltas:
            index = int(getattr(delta, "index", 0) or 0)
            entry = tool_calls.setdefault(
                index,
                {
                    "id": "",
                    "type": "function",
                    "function": {"name": "", "arguments": ""},
                },
            )
            call_id = getattr(delta, "id", None)
            if call_id:
                entry["id"] = call_id
            call_type = getattr(delta, "type", None)
            if call_type:
                entry["type"] = call_type
            function_delta = getattr(delta, "function", None)
            if not function_delta:
                continue
            function = entry["function"]
            name_part = getattr(function_delta, "name", None)
            if name_part:
                function["name"] += name_part
            arguments_part = getattr(function_delta, "arguments", None)
            if arguments_part:
                function["arguments"] += arguments_part

    @staticmethod
    def _ordered_tool_calls(
        tool_calls: dict[int, dict[str, Any]],
        *,
        turn_index: int,
    ) -> list[dict[str, Any]]:
        ordered: list[dict[str, Any]] = []
        for index, tool_call in sorted(tool_calls.items()):
            function = tool_call.get("function") or {}
            name = str(function.get("name") or "").strip()
            if not name:
                continue
            call_id = str(tool_call.get("id") or f"call_{turn_index}_{index}")
            ordered.append(
                {
                    "id": call_id,
                    "type": "function",
                    "function": {
                        "name": name,
                        "arguments": str(function.get("arguments") or "{}"),
                    },
                }
            )
        return ordered

    @staticmethod
    def _step_event(
        text: str,
        *,
        status: str = "completed",
        tool_name: str | None = None,
        output_preview: str | None = None,
    ) -> AgentRunStreamEvent:
        event: AgentRunStreamEvent = {
            "type": "step",
            "text": text,
            "status": status,
        }
        if tool_name:
            event["tool_name"] = tool_name
        if output_preview:
            event["output_preview"] = output_preview[:500]
        return event

    @staticmethod
    def _message_event(
        *,
        delta: str | None = None,
        text: str | None = None,
        status: str = "streaming",
    ) -> AgentRunStreamEvent:
        event: AgentRunStreamEvent = {
            "type": "message",
            "role": "assistant",
            "status": status,
        }
        if delta is not None:
            event["delta"] = delta
        if text is not None:
            event["text"] = text
        return event

    @staticmethod
    def _artifact_card_event(row: ConversationDocumentRow) -> AgentRunStreamEvent:
        return {
            "type": "card",
            "card": {
                "type": "artifact",
                "document": document_to_schema(row).model_dump(mode="json"),
            },
        }

    @staticmethod
    def _instructions() -> str:
        return "\n".join(
            [
                "You are a general-purpose office assistant.",
                "The input includes the current conversation history and all conversation documents, including prior artifacts.",
                "Long history and documents may be represented as compact previews to fit the model context window.",
                "Use the conversation history to resolve references such as previous requests, earlier answers, and generated files.",
                "The user may reference Markdown documents converted by Microsoft MarkItDown.",
                "Use list_conversation_documents and read_document_markdown to inspect conversation files when previews are insufficient; read_document_markdown returns bounded slices, so continue with the next start offset when needed. Do not claim access to the server filesystem.",
                "Use analyze_image when the user asks about an uploaded image or visual details are required. The tool uses the configured multimodal provider and returns text for reasoning.",
                "Use web_search at most once for public web lookup or current information requests.",
                "If web_search returns a tool error or no usable results, do not call it again; answer from existing knowledge and state the limitation.",
                "Do not claim live web access unless web_search returns actual result entries.",
                "Answer directly in the conversation for normal questions, analysis, summaries, edits, plans, and brainstorming.",
                "When the user asks for reusable, downloadable, or editable file-like deliverables (.md, .html, etc.), save them with artifact tools.",
                "For short Markdown only, you may use write_artifacts with plain content.",
                "For .html or any large/complex content, use start_artifact, then append_artifact with content_base64 chunks, then finish_artifact.",
                "Never put raw HTML in write_artifacts.content JSON strings; that breaks tool arguments.",
                "After artifact files are saved, keep the final answer concise and mention the created filenames.",
                "If artifact tools fail, you may fall back to artifact blocks in the final answer:",
                "<artifact title=\"Human title\" filename=\"file.md\">file content</artifact>.",
                "Keep artifact files concise. If the user asks for an unlimited or very long document, create a useful first version instead of trying to exhaust the topic.",
            ]
        )

    def _model_params(
        self,
        *,
        thinking: bool | None,
        reasoning_effort: ReasoningEffort | None,
    ) -> tuple[dict[str, Any], int]:
        extra_body, max_tokens = bounded_extra_body_and_max_tokens(
            self._provider.extra_body,
            default_max_tokens=self._settings.agent_max_output_tokens,
        )
        if thinking is not None:
            extra_body["thinking"] = {"type": "enabled" if thinking else "disabled"}
        if reasoning_effort is not None:
            extra_body["reasoning_effort"] = reasoning_effort
        return extra_body, max_tokens

    @staticmethod
    def _build_input(
        *,
        prompt: str,
        messages: Sequence[MessageRow],
        documents: Sequence[ConversationDocumentRow],
        selected_documents: Sequence[ConversationDocumentRow],
    ) -> str:
        settings = get_settings()
        sections: list[str] = []
        if messages:
            sections.append(
                AgentRunService._conversation_history_context(
                    messages[-settings.agent_context_recent_messages :],
                    max_chars_per_message=settings.agent_context_message_max_chars,
                )
            )
        document_context = AgentRunService._documents_context(
            documents,
            selected_ids={row.id for row in selected_documents},
            preview_chars=settings.agent_context_document_preview_chars,
            selected_preview_chars=settings.agent_context_selected_document_preview_chars,
        )
        if document_context:
            sections.append(document_context)
        sections.append(
            "\n".join(
                [
                    "<current_user_request>",
                    prompt,
                    "</current_user_request>",
                ]
            )
        )
        return AgentRunService._truncate_context(
            "\n\n".join(sections),
            max_chars=settings.agent_context_max_chars,
            preserve_tail_chars=max(settings.agent_context_message_max_chars, len(prompt) + 200),
        )

    @staticmethod
    def _conversation_history_context(messages: Sequence[MessageRow], *, max_chars_per_message: int) -> str:
        blocks: list[str] = []
        for index, row in enumerate(messages, start=1):
            content = AgentRunService._truncate_text(row.content, max_chars=max_chars_per_message)
            blocks.append(
                "\n".join(
                    [
                        f"### Message {index}",
                        f"Role: {row.role}",
                        f"Status: {row.status}",
                        "",
                        content,
                    ]
                )
            )
        return "\n\n".join(
            [
                "<conversation_history>",
                *blocks,
                "</conversation_history>",
            ]
        )

    @staticmethod
    def _documents_context(
        documents: Sequence[ConversationDocumentRow],
        *,
        selected_ids: set[str],
        preview_chars: int,
        selected_preview_chars: int,
    ) -> str:
        if not documents:
            return ""
        blocks: list[str] = []
        ordered_documents = sorted(documents, key=lambda row: (row.id not in selected_ids, row.created_at))
        for index, row in enumerate(ordered_documents, start=1):
            limit = selected_preview_chars if row.id in selected_ids else preview_chars
            preview = AgentRunService._truncate_text(row.content_md, max_chars=limit)
            blocks.append(
                "\n".join(
                    [
                        f"### Document {index}: {row.title}",
                        f"Document ID: {row.id}",
                        f"Filename: {row.filename}",
                        f"Kind: {row.kind}",
                        f"MIME: {row.mime_type}",
                        f"Source MIME: {row.source_mime_type or 'none'}",
                        f"Has original image: {'yes' if row.source_object_key and (row.source_mime_type or '').startswith('image/') else 'no'}",
                        f"Full chars: {len(row.content_md)}",
                        "Preview:",
                        preview,
                    ]
                )
            )
        return "\n\n".join(
            [
                "<conversation_documents mode='index_and_preview'>",
                "Use read_document_markdown(document_id) when full content is needed.",
                *blocks,
                "</conversation_documents>",
            ]
        )

    @staticmethod
    def _truncate_context(text: str, *, max_chars: int, preserve_tail_chars: int) -> str:
        if len(text) <= max_chars:
            return text
        min_head_chars = min(1_000, max_chars // 4)
        tail_chars = min(max(1, preserve_tail_chars), max_chars - min_head_chars)
        head_chars = max_chars - tail_chars
        return (
            text[:head_chars].rstrip()
            + "\n\n...[context truncated to fit provider prompt budget]...\n\n"
            + text[-tail_chars:].lstrip()
        )

    @staticmethod
    def _truncate_text(text: str, *, max_chars: int) -> str:
        if len(text) <= max_chars:
            return text
        return text[:max_chars].rstrip() + f"\n...[truncated {len(text) - max_chars} chars; use tools for full content]"

    async def _recover_artifacts_from_assistant_content(
        self,
        *,
        conversation_id: str,
        context: ConversationAgentContext,
        assistant_content: str,
    ) -> str | None:
        if not _ARTIFACT_BLOCK_RE.search(assistant_content):
            return None
        created_before = len(context.created_documents)
        try:
            await self._materialize_artifact_blocks(
                conversation_id=conversation_id,
                context=context,
                message=assistant_content,
            )
        except RequestError:
            return None
        created = context.created_documents[created_before:]
        if not created:
            return None
        return "\n".join(
            f"Created artifact {row.id}: {row.title} ({row.filename}, {row.mime_type})"
            for row in created
        )

    async def _materialize_artifact_blocks(
        self,
        *,
        conversation_id: str,
        context: ConversationAgentContext,
        message: str,
    ) -> str:
        matches = list(_ARTIFACT_BLOCK_RE.finditer(message))
        if not matches:
            return message

        settings = self._settings
        if len(matches) > settings.agent_artifact_max_files:
            raise RequestError(
                "too many artifact blocks",
                details={"max_artifacts": settings.agent_artifact_max_files},
            )

        created: list[ConversationDocumentRow] = []
        total_chars = 0
        for match in matches:
            attrs = self._artifact_attrs(match.group(1))
            content = self._strip_artifact_fence(match.group(2).strip())
            total_chars += len(content)
            if len(content) > settings.agent_artifact_max_chars:
                raise RequestError(
                    "artifact content is too large",
                    details={
                        "filename": attrs.get("filename") or attrs.get("title") or "artifact.md",
                        "max_chars": settings.agent_artifact_max_chars,
                        "actual_chars": len(content),
                    },
                )
            if total_chars > settings.agent_artifact_total_max_chars:
                raise RequestError(
                    "artifact batch is too large",
                    details={
                        "max_total_chars": settings.agent_artifact_total_max_chars,
                        "actual_total_chars": total_chars,
                    },
                )

            title = (attrs.get("title") or attrs.get("filename") or "Artifact").strip()
            filename = self._safe_artifact_filename(attrs.get("filename") or title)
            row = await ConversationDocumentService(self._session, self._current_user).create_artifact_row(
                conversation_id=conversation_id,
                kind="artifact",
                title=title[:120],
                filename=filename,
                mime_type=self._artifact_mime_type(filename, content),
                content_md=content,
            )
            created.append(row)

        context.created_documents.extend(created)
        stripped = _ARTIFACT_BLOCK_RE.sub("", message).strip()
        if stripped:
            return stripped
        if len(created) == 1:
            return f"已生成文档: {created[0].title}"
        titles = "、".join(row.title for row in created)
        return f"已生成 {len(created)} 个文档: {titles}"

    @staticmethod
    def _artifact_attrs(raw: str) -> dict[str, str]:
        return {key: html_lib.unescape(value).strip() for key, _, value in _ARTIFACT_ATTR_RE.findall(raw)}

    @staticmethod
    def _strip_artifact_fence(content: str) -> str:
        match = re.match(r"(?is)^```[\w+-]*\s*\n(.*?)\n```\s*$", content)
        return match.group(1).strip() if match else content

    @staticmethod
    def _safe_artifact_filename(filename: str) -> str:
        safe = Path(filename).name.strip() or "artifact.md"
        if "." not in safe:
            safe = f"{safe}.md"
        return safe[:160]

    @staticmethod
    def _artifact_mime_type(filename: str, content: str) -> str:
        lowered = filename.lower()
        if lowered.endswith((".html", ".htm")) or content.lower().lstrip().startswith(("<!doctype html", "<html")):
            return "text/html"
        return "text/markdown"

    @staticmethod
    def _assistant_content(
        *,
        steps: Sequence[str],
        summary: str,
        created_documents: Sequence[ConversationDocumentRow],
    ) -> str:
        sections: list[str] = []
        if steps:
            sections.append("\n".join(f"- {step}" for step in steps))
        if summary:
            sections.append(summary)
        return with_document_refs("\n\n".join(sections).strip() or "已完成。", created_documents)

    @staticmethod
    def _assistant_summary(message: str, created_documents: Sequence[ConversationDocumentRow]) -> str:
        if message:
            return message
        if not created_documents:
            return "已完成。"
        if len(created_documents) == 1:
            return f"已生成文档: {created_documents[0].title}"
        titles = "、".join(row.title for row in created_documents)
        return f"已生成 {len(created_documents)} 个文档: {titles}"
