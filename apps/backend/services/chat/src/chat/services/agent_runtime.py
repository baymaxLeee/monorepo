"""OpenAI Agents SDK runtime for conversation documents."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from typing import Any

from agents import (
    Agent,
    ModelSettings,
    OpenAIChatCompletionsModel,
    Runner,
    RunResultStreaming,
    set_tracing_disabled,
)
from agents.stream_events import AgentUpdatedStreamEvent, RawResponsesStreamEvent, RunItemStreamEvent
from kernel.errors import BaseError, RequestError
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from chat.config import get_settings
from chat.crud import conversations as conversation_crud
from chat.crud import messages as message_crud
from chat.deps import AuthContext
from chat.models.document import ConversationDocumentRow
from chat.models.message import MessageRow
from chat.schemas.conversation import ReasoningEffort
from chat.services.admin_client import ProviderSnapshot
from chat.services.agent_tools import agent_runtime_tools
from chat.services.documents import (
    ConversationDocumentService,
    document_to_schema,
    with_document_context,
    with_document_refs,
)

set_tracing_disabled(disabled=True)


@dataclass
class ConversationAgentContext:
    session: AsyncSession
    current_user: AuthContext
    conversation_id: str
    documents: dict[str, ConversationDocumentRow]
    messages: list[MessageRow]
    created_documents: list[ConversationDocumentRow] = field(default_factory=list)
    tool_write_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

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
    ) -> None:
        self._session = session
        self._current_user = current_user
        self._provider = provider
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

        step = "已接收任务 正在准备上下文"
        steps.append(step)
        yield self._step_event(step)
        if context.messages:
            step = f"已加载 {len(context.messages)} 条历史消息"
            steps.append(step)
            yield self._step_event(step)
        if context.documents:
            step = f"已加载 {len(context.documents)} 个会话文档"
            steps.append(step)
            yield self._step_event(step)

        await self._persist_user_message(conversation_id, prompt, selected_document_rows)

        step = "正在调用模型"
        steps.append(step)
        yield self._step_event(step)

        result = None
        client = None
        summary_parts: list[str] = []
        emitted_steps: set[str] = set()
        emitted_card_document_ids: set[str] = set()
        try:
            async with asyncio.timeout(self._settings.agent_run_timeout_seconds):
                result, client = await self._run_agent_streamed(
                    prompt=prompt,
                    context=context,
                    thinking=thinking,
                    reasoning_effort=reasoning_effort,
                )
                async for event in result.stream_events():
                    if isinstance(event, RawResponsesStreamEvent):
                        delta = self._extract_text_delta(event)
                        if delta:
                            summary_parts.append(delta)
                            yield self._message_event(delta=delta)
                        continue

                    step_event = self._stream_step_event(event)
                    if step_event:
                        step_key = self._step_key(step_event)
                        if step_key and step_key in emitted_steps:
                            continue
                        if step_key:
                            emitted_steps.add(step_key)
                        step_text = str(step_event.get("text") or "")
                        if step_text:
                            steps.append(step_text)
                        yield step_event

                    if isinstance(event, RunItemStreamEvent) and event.name == "tool_output":
                        for row in context.created_documents:
                            if row.id in emitted_card_document_ids:
                                continue
                            emitted_card_document_ids.add(row.id)
                            yield self._artifact_card_event(row)
        except TimeoutError as exc:
            await self._persist_failed_assistant_message(
                conversation_id=conversation_id,
                message="agent run timed out",
                created_documents=context.created_documents,
                steps=steps,
                partial_summary="".join(summary_parts).strip(),
            )
            if client is not None:
                await self._session.rollback()
                await client.close()
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
                partial_summary="".join(summary_parts).strip(),
            )
            if client is not None:
                await self._session.rollback()
                await client.close()
            raise AgentRuntimeError(
                "agent run failed",
                details={"provider": self._provider.name, "reason": str(exc)},
            ) from exc
        else:
            if client is not None:
                await client.close()

        message = "" if result is None else str(result.final_output).strip()
        final_summary = "".join(summary_parts).strip() or message
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
            text=message,
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
            messages=message_rows,
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

    def _build_agent(
        self,
        *,
        thinking: bool | None,
        reasoning_effort: ReasoningEffort | None,
    ) -> tuple[Agent[ConversationAgentContext], AsyncOpenAI]:
        client = AsyncOpenAI(
            api_key=self._provider.api_key,
            base_url=self._provider.base_url,
            timeout=self._settings.llm_timeout_seconds,
        )
        model = OpenAIChatCompletionsModel(
            model=self._provider.model,
            openai_client=client,
        )
        agent = Agent[ConversationAgentContext](
            name="Conversation document agent",
            model=model,
            instructions=self._instructions(),
            model_settings=self._model_settings(
                thinking=thinking,
                reasoning_effort=reasoning_effort,
            ),
            tools=self._tools(),
            tool_use_behavior={"stop_at_tool_names": ["write_artifacts"]},
        )
        return agent, client

    async def _run_agent_streamed(
        self,
        *,
        prompt: str,
        context: ConversationAgentContext,
        thinking: bool | None,
        reasoning_effort: ReasoningEffort | None,
    ) -> tuple[RunResultStreaming, AsyncOpenAI]:
        agent, client = self._build_agent(
            thinking=thinking,
            reasoning_effort=reasoning_effort,
        )
        agent_input = self._build_input(
            prompt=prompt,
            messages=context.messages,
            documents=list(context.documents.values()),
        )
        try:
            result = Runner.run_streamed(
                agent,
                input=agent_input,
                context=context,
                max_turns=self._settings.agent_max_turns,
            )
            return result, client
        except Exception:
            await self._session.rollback()
            await client.close()
            raise

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
    def _extract_text_delta(event: RawResponsesStreamEvent) -> str | None:
        data = event.data
        event_type = getattr(data, "type", "")
        if event_type in {"response.output_text.delta", "response.refusal.delta"}:
            delta = getattr(data, "delta", None)
            if isinstance(delta, str) and delta:
                return delta

        choices = getattr(data, "choices", None)
        if not choices:
            return None
        delta = getattr(choices[0], "delta", None)
        if delta is None:
            return None
        if getattr(delta, "tool_calls", None):
            return None
        content = getattr(delta, "content", None)
        if isinstance(content, str) and content:
            return content
        return None

    @staticmethod
    def _stream_step_event(event: Any) -> AgentRunStreamEvent | None:
        if isinstance(event, AgentUpdatedStreamEvent):
            return AgentRunService._step_event(f"切换到 Agent: {event.new_agent.name}")
        if not isinstance(event, RunItemStreamEvent):
            return None
        if event.name == "reasoning_item_created":
            return AgentRunService._step_event("正在推理和规划下一步", status="running")
        if event.name == "tool_called":
            item_name = getattr(event.item, "name", None)
            return AgentRunService._step_event(
                f"正在调用工具{f': {item_name}' if item_name else ''}",
                status="running",
                tool_name=item_name,
            )
        if event.name == "tool_output":
            item_name = getattr(event.item, "name", None)
            output = getattr(event.item, "output", None)
            return AgentRunService._step_event(
                f"工具执行完成{f': {item_name}' if item_name else ''}",
                status="completed",
                tool_name=item_name,
                output_preview=str(output) if output else None,
            )
        if event.name == "message_output_created":
            return AgentRunService._step_event("正在整理最终回复", status="running")
        if event.name == "handoff_requested":
            return AgentRunService._step_event("正在请求任务交接", status="running")
        if event.name == "handoff_occured":
            return AgentRunService._step_event("任务交接完成")
        return None

    @staticmethod
    def _step_key(event: AgentRunStreamEvent) -> str:
        status = event.get("status", "")
        tool_name = event.get("tool_name", "")
        text = event.get("text", "")
        return f"{status}:{tool_name}:{text}"

    @staticmethod
    def _instructions() -> str:
        return "\n".join(
            [
                "You are a general-purpose office assistant.",
                "The input includes the current conversation history and all conversation documents, including prior artifacts.",
                "Use the conversation history to resolve references such as previous requests, earlier answers, and generated files.",
                "The user may reference Markdown documents converted by Microsoft MarkItDown.",
                "Use search_conversation for retrieval across history and documents before asking the user to resend context.",
                "Use list_conversation_documents and read_document_markdown to inspect conversation files. Do not claim access to the server filesystem.",
                "Use web_search for public web lookup or current information requests. Do not claim web access unless web_search succeeds.",
                "Answer directly in the conversation for normal questions, analysis, summaries, edits, plans, and brainstorming.",
                "Call write_artifacts when you decide the user needs reusable, downloadable, or editable file-like deliverables.",
                "Use write_artifacts for both single-file and multi-file output; put every requested file in one call.",
                "If you create an artifact, keep the final answer concise and mention it instead of pasting the full file content.",
                "Artifacts are persisted in the conversation document table. For HTML artifacts, write the raw complete HTML string directly as content_markdown, without wrapping it in a fenced code block, and use a .html filename.",
            ]
        )

    @staticmethod
    def _tools() -> list[Any]:
        return agent_runtime_tools()

    def _model_settings(
        self,
        *,
        thinking: bool | None,
        reasoning_effort: ReasoningEffort | None,
    ) -> ModelSettings:
        extra_body: dict[str, Any] = dict(self._provider.extra_body)
        if thinking is not None:
            extra_body["thinking"] = {"type": "enabled" if thinking else "disabled"}
        if reasoning_effort is not None:
            extra_body["reasoning_effort"] = reasoning_effort
        return ModelSettings(
            # OpenAI-compatible providers vary in parallel tool-call support.
            # Sequential tools are slower but much more reliable for artifact
            # creation because each write becomes visible before the next turn.
            parallel_tool_calls=False,
            extra_body=extra_body or None,
        )

    @staticmethod
    def _build_input(
        *,
        prompt: str,
        messages: Sequence[MessageRow],
        documents: Sequence[ConversationDocumentRow],
    ) -> str:
        sections: list[str] = []
        if messages:
            sections.append(AgentRunService._conversation_history_context(messages))
        sections.append(
            "\n".join(
                [
                    "<current_user_request>",
                    prompt,
                    "</current_user_request>",
                ]
            )
        )
        return with_document_context("\n\n".join(sections), documents)

    @staticmethod
    def _conversation_history_context(messages: Sequence[MessageRow]) -> str:
        blocks: list[str] = []
        for index, row in enumerate(messages, start=1):
            blocks.append(
                "\n".join(
                    [
                        f"### Message {index}",
                        f"Role: {row.role}",
                        f"Status: {row.status}",
                        "",
                        row.content,
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
