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
    RunContextWrapper,
    Runner,
    RunResult,
    RunResultStreaming,
    function_tool,
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
from chat.schemas.agent import AgentRunResult, AgentToolCall
from chat.schemas.conversation import ReasoningEffort
from chat.services.admin_client import ProviderSnapshot
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
    created_documents: list[ConversationDocumentRow] = field(default_factory=list)
    tool_calls: list[AgentToolCall] = field(default_factory=list)
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

    def record_tool_call(self, name: str, input_text: str, output: str) -> None:
        self.tool_calls.append(
            AgentToolCall(
                name=name,
                input=input_text,
                output_preview=output[:500],
            )
        )


class AgentRuntimeError(BaseError):
    status_code = 502
    code = "agent_runtime_failed"


type AgentRunStreamEvent = dict[str, Any]


@function_tool
def list_conversation_documents(ctx: RunContextWrapper[ConversationAgentContext]) -> str:
    """List Markdown documents available in this conversation."""

    rows = list(ctx.context.documents.values()) + ctx.context.created_documents
    if rows:
        output = "\n".join(f"- {row.id}: {row.title} ({row.kind}, {row.filename})" for row in rows)
    else:
        output = "No conversation documents."
    ctx.context.record_tool_call("list_conversation_documents", "", output)
    return output


@function_tool
def read_document_markdown(
    ctx: RunContextWrapper[ConversationAgentContext],
    document_id: str,
) -> str:
    """Read a conversation document's Markdown content.

    Args:
        document_id: Document ID from list_conversation_documents.
    """

    row = ctx.context.get_document(document_id)
    output = row.content_md
    ctx.context.record_tool_call("read_document_markdown", document_id, output)
    return output


@function_tool(timeout=20.0)
async def write_artifact(
    ctx: RunContextWrapper[ConversationAgentContext],
    title: str,
    filename: str,
    content_markdown: str,
) -> str:
    """Create a Markdown artifact document in the current conversation.

    Args:
        title: Human-readable artifact title.
        filename: Markdown filename, preferably ending in .md.
        content_markdown: Complete Markdown content for the artifact.
    """

    async with ctx.context.tool_write_lock:
        row = await ConversationDocumentService(ctx.context.session, ctx.context.current_user).create_artifact_row(
            conversation_id=ctx.context.conversation_id,
            kind="artifact",
            title=title,
            filename=filename if filename.endswith(".md") else f"{filename}.md",
            mime_type="text/markdown",
            content_md=content_markdown,
        )
    ctx.context.created_documents.append(row)
    output = f"Created artifact {row.id}: {row.title}"
    ctx.context.record_tool_call("write_artifact", title, output)
    return output


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

    async def run(
        self,
        *,
        conversation_id: str,
        prompt: str,
        document_ids: list[str],
        thinking: bool | None = None,
        reasoning_effort: ReasoningEffort | None = None,
    ) -> AgentRunResult:
        if not prompt.strip():
            raise RequestError("agent prompt is required")
        context, document_rows = await self._prepare_context(conversation_id, document_ids)
        await self._persist_user_message(conversation_id, prompt, document_rows)

        try:
            result, client = await self._run_agent(
                prompt=prompt,
                document_rows=document_rows,
                context=context,
                thinking=thinking,
                reasoning_effort=reasoning_effort,
            )
        except Exception as exc:
            raise AgentRuntimeError(
                "agent run failed",
                details={"provider": self._provider.name, "reason": str(exc)},
            ) from exc
        await client.close()

        message = "" if result is None else str(result.final_output).strip()
        await self._persist_assistant_message(
            conversation_id=conversation_id,
            message=message,
            created_documents=context.created_documents,
            steps=[],
        )

        return AgentRunResult(
            message=message,
            created_documents=[document_to_schema(row) for row in context.created_documents],
            tool_calls=context.tool_calls,
        )

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
        context, document_rows = await self._prepare_context(conversation_id, document_ids)

        steps: list[str] = []

        step = "已接收任务 正在准备上下文"
        steps.append(step)
        yield self._step_event(step)
        if document_rows:
            step = f"已加载 {len(document_rows)} 个会话文档"
            steps.append(step)
            yield self._step_event(step)

        await self._persist_user_message(conversation_id, prompt, document_rows)

        step = "正在调用模型"
        steps.append(step)
        yield self._step_event(step)

        result = None
        client = None
        summary_parts: list[str] = []
        emitted_steps: set[str] = set()
        try:
            result, client = await self._run_agent_streamed(
                prompt=prompt,
                document_rows=document_rows,
                context=context,
                thinking=thinking,
                reasoning_effort=reasoning_effort,
            )
            async for event in result.stream_events():
                if isinstance(event, RawResponsesStreamEvent):
                    delta = self._extract_text_delta(event)
                    if delta:
                        summary_parts.append(delta)
                        yield {"type": "summary_delta", "delta": delta}
                    continue

                step = self._stream_step(event)
                if step and step not in emitted_steps:
                    emitted_steps.add(step)
                    steps.append(step)
                    yield self._step_event(step)
        except Exception as exc:
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
            yield {
                "type": "artifacts",
                "documents": [
                    document_to_schema(row).model_dump(mode="json") for row in context.created_documents
                ],
            }

        yield {
            "type": "done",
            "message": message,
            "tool_calls": [tool_call.model_dump(mode="json") for tool_call in context.tool_calls],
        }

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

        document_rows = await ConversationDocumentService(
            self._session,
            self._current_user,
        ).get_rows(conversation_id, document_ids)
        context = ConversationAgentContext(
            session=self._session,
            current_user=self._current_user,
            conversation_id=conversation_id,
            documents={row.id: row for row in document_rows},
        )

        if conversation.provider_id != self._provider.id or conversation.model != self._provider.model:
            conversation.provider_id = self._provider.id
            conversation.model = self._provider.model

        return context, list(document_rows)

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
            status="ok",
        )
        conversation = await conversation_crud.get_conversation(
            self._session,
            conversation_id,
            self._current_user.user_id,
            self._current_user.is_admin,
        )
        if conversation is not None:
            await conversation_crud.touch_conversation(self._session, conversation)

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
        )
        return agent, client

    async def _run_agent(
        self,
        *,
        prompt: str,
        document_rows: Sequence[ConversationDocumentRow],
        context: ConversationAgentContext,
        thinking: bool | None,
        reasoning_effort: ReasoningEffort | None,
    ) -> tuple[RunResult, AsyncOpenAI]:
        agent, client = self._build_agent(
            thinking=thinking,
            reasoning_effort=reasoning_effort,
        )
        agent_input = self._build_input(prompt, document_rows)
        try:
            result = await Runner.run(
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

    async def _run_agent_streamed(
        self,
        *,
        prompt: str,
        document_rows: Sequence[ConversationDocumentRow],
        context: ConversationAgentContext,
        thinking: bool | None,
        reasoning_effort: ReasoningEffort | None,
    ) -> tuple[RunResultStreaming, AsyncOpenAI]:
        agent, client = self._build_agent(
            thinking=thinking,
            reasoning_effort=reasoning_effort,
        )
        agent_input = self._build_input(prompt, document_rows)
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
    def _step_event(text: str) -> AgentRunStreamEvent:
        return {"type": "step", "text": text}

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
    def _stream_step(event: Any) -> str | None:
        if isinstance(event, AgentUpdatedStreamEvent):
            return f"切换到 Agent: {event.new_agent.name}"
        if not isinstance(event, RunItemStreamEvent):
            return None
        if event.name == "reasoning_item_created":
            return "正在推理和规划下一步"
        if event.name == "tool_called":
            item_name = getattr(event.item, "name", None)
            return f"正在调用工具{f': {item_name}' if item_name else ''}"
        if event.name == "tool_output":
            return "工具执行完成 正在读取结果"
        if event.name == "message_output_created":
            return "正在整理最终回复"
        if event.name == "handoff_requested":
            return "正在请求任务交接"
        if event.name == "handoff_occured":
            return "任务交接完成"
        return None

    @staticmethod
    def _instructions() -> str:
        return "\n".join(
            [
                "You are a general-purpose office assistant.",
                "The user may reference Markdown documents converted by Microsoft MarkItDown.",
                "Use list_conversation_documents and read_document_markdown when documents are relevant.",
                "Answer directly in the conversation for normal questions, analysis, summaries, edits, plans, and brainstorming.",
                "Call write_artifact only when you decide the user needs a reusable, downloadable, or editable file-like deliverable.",
                "If you create an artifact, keep the final answer concise and mention it instead of pasting the full file content.",
                "Artifacts are persisted in the Markdown document table. If you create an HTML artifact, write the raw complete HTML string directly as content_markdown, without wrapping it in a fenced code block.",
            ]
        )

    @staticmethod
    def _tools() -> list[Any]:
        return [list_conversation_documents, read_document_markdown, write_artifact]

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
            parallel_tool_calls=True,
            extra_body=extra_body or None,
        )

    @staticmethod
    def _build_input(prompt: str, documents: Sequence[ConversationDocumentRow]) -> str:
        return with_document_context(prompt, documents)

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
