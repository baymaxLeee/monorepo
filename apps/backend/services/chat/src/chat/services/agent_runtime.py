"""OpenAI Agents SDK runtime for conversation documents."""

from __future__ import annotations

import asyncio
import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from agents import (
    Agent,
    ModelSettings,
    OpenAIChatCompletionsModel,
    RunContextWrapper,
    Runner,
    RunResult,
    function_tool,
    set_tracing_disabled,
)
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

        await message_crud.create_message(
            self._session,
            conversation_id=conversation_id,
            role="user",
            content=with_document_refs(prompt, document_rows),
            status="ok",
        )

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
            instructions=self._instructions(artifact_required=self._wants_artifact(prompt)),
            model_settings=self._model_settings(
                prompt,
                thinking=thinking,
                reasoning_effort=reasoning_effort,
            ),
            tools=self._tools(prompt),
        )

        result: RunResult | None = None
        try:
            result = await Runner.run(
                agent,
                input=self._build_input(prompt, document_rows),
                context=context,
                max_turns=self._settings.agent_max_turns,
            )
        except Exception as exc:
            await self._session.rollback()
            if self._wants_artifact(prompt):
                context.record_tool_call(
                    "forced_tool_call_failed",
                    "tool_choice=write_artifact",
                    str(exc),
                )
                if not context.created_documents:
                    try:
                        result = await self._run_text_fallback(
                            model=model,
                            prompt=prompt,
                            document_rows=document_rows,
                            context=context,
                        )
                    finally:
                        await client.close()
                else:
                    await client.close()
            else:
                await client.close()
                raise AgentRuntimeError(
                    "agent run failed",
                    details={"provider": self._provider.name, "reason": str(exc)},
                ) from exc
        else:
            await client.close()

        message = "" if result is None else str(result.final_output).strip()
        if not context.created_documents and self._should_persist_fallback(prompt, message):
            fallback_rows = await self._create_fallback_artifacts(
                conversation_id=conversation_id,
                prompt=prompt,
                content=message,
            )
            context.created_documents.extend(fallback_rows)
            context.record_tool_call(
                "write_artifact_fallback",
                "agent final_output",
                f"Created {len(fallback_rows)} artifact(s)",
            )

        assistant_text = self._assistant_summary(message, context.created_documents)
        assistant_content = with_document_refs(assistant_text, context.created_documents)
        await message_crud.create_message(
            self._session,
            conversation_id=conversation_id,
            role="assistant",
            content=assistant_content,
            status="ok",
        )
        await conversation_crud.touch_conversation(self._session, conversation)

        return AgentRunResult(
            message=message,
            created_documents=[document_to_schema(row) for row in context.created_documents],
            tool_calls=context.tool_calls,
        )

    async def _run_text_fallback(
        self,
        *,
        model: OpenAIChatCompletionsModel,
        prompt: str,
        document_rows: Sequence[ConversationDocumentRow],
        context: ConversationAgentContext,
    ) -> RunResult:
        agent = Agent[ConversationAgentContext](
            name="Conversation document fallback writer",
            model=model,
            instructions=self._fallback_instructions(),
            tools=[],
        )
        try:
            return await Runner.run(
                agent,
                input=self._build_input(prompt, document_rows),
                context=context,
                max_turns=1,
            )
        except Exception as exc:
            raise AgentRuntimeError(
                "agent run failed",
                details={"provider": self._provider.name, "reason": str(exc)},
            ) from exc

    @staticmethod
    def _instructions(*, artifact_required: bool) -> str:
        lines = [
            "You are a conversation document agent.",
            "The user may reference Markdown documents converted by Microsoft MarkItDown.",
            "Use list_conversation_documents and read_document_markdown when documents are relevant.",
        ]
        if artifact_required:
            lines.extend(
                [
                    "This request requires file-like deliverables. You MUST call write_artifact once for each requested file.",
                    "If the user asks for both HTML and Markdown, call write_artifact twice: one artifact for the HTML source and one artifact for the Markdown summary.",
                    "Never place complete HTML or long Markdown artifact content in your final answer. Persist it with write_artifact instead.",
                ]
            )
        else:
            lines.extend(
                [
                    "If the user asks for a complete document, report, plan, HTML source, Markdown file, or other file-like deliverable, call write_artifact with complete Markdown content.",
                    "Never place complete HTML or long Markdown artifact content in your final answer. Persist it with write_artifact instead.",
                ]
            )
        lines.extend(
            [
                "Artifacts are persisted in the Markdown document table. If the user wants HTML, write the raw complete HTML string directly as content_markdown, without wrapping it in a fenced code block.",
                "Your final answer should be concise and mention any artifact you created. Do not include the full artifact content after calling write_artifact.",
            ]
        )
        return "\n".join(lines)

    @staticmethod
    def _fallback_instructions() -> str:
        return "\n".join(
            [
                "You generate complete artifact content for persistence by the server.",
                "Return the full requested file content only.",
                "For HTML files, return the raw complete HTML string directly.",
                "If multiple non-HTML files are requested, return one fenced code block per file using the right language tag, such as markdown.",
            ]
        )

    @staticmethod
    def _tools(prompt: str) -> list[Any]:
        if AgentRunService._wants_artifact(prompt):
            return [write_artifact]
        return [list_conversation_documents, read_document_markdown, write_artifact]

    def _model_settings(
        self,
        prompt: str,
        *,
        thinking: bool | None,
        reasoning_effort: ReasoningEffort | None,
    ) -> ModelSettings:
        extra_body: dict[str, Any] = dict(self._provider.extra_body)
        if AgentRunService._wants_artifact(prompt):
            extra_body["thinking"] = {"type": "disabled"}
            return ModelSettings(
                tool_choice="required",
                parallel_tool_calls=True,
                extra_body=extra_body,
            )
        if thinking is not None:
            extra_body["thinking"] = {"type": "enabled" if thinking else "disabled"}
        if reasoning_effort is not None:
            extra_body["reasoning_effort"] = reasoning_effort
        return ModelSettings(extra_body=extra_body or None)

    @staticmethod
    def _build_input(prompt: str, documents: Sequence[ConversationDocumentRow]) -> str:
        return with_document_context(prompt, documents)

    async def _create_fallback_artifacts(
        self,
        *,
        conversation_id: str,
        prompt: str,
        content: str,
    ) -> list[ConversationDocumentRow]:
        blocks = self._extract_fenced_artifacts(content)
        if not blocks:
            title = self._fallback_title(prompt)
            blocks = [(title, f"{title}.md", self._normalize_artifact_markdown(content))]

        rows: list[ConversationDocumentRow] = []
        service = ConversationDocumentService(self._session, self._current_user)
        for title, filename, markdown in blocks:
            rows.append(
                await service.create_artifact_row(
                    conversation_id=conversation_id,
                    kind="artifact",
                    title=title,
                    filename=filename,
                    mime_type="text/markdown",
                    content_md=markdown,
                )
            )
        return rows

    @staticmethod
    def _assistant_summary(message: str, created_documents: Sequence[ConversationDocumentRow]) -> str:
        if not created_documents:
            return message or "已完成。"
        if len(created_documents) == 1:
            return f"已生成文档: {created_documents[0].title}"
        titles = "、".join(row.title for row in created_documents)
        return f"已生成 {len(created_documents)} 个文档: {titles}"

    @staticmethod
    def _should_persist_fallback(prompt: str, content: str) -> bool:
        stripped = content.strip()
        if not stripped:
            return False
        lowered = stripped.lower()
        if any(marker in lowered for marker in ("<!doctype html", "<html", "```html", "```markdown")):
            return True
        prompt_lower = prompt.lower()
        file_intent = any(
            marker in prompt_lower
            for marker in (
                "html",
                "markdown",
                " md",
                ".md",
                "文件",
                "文档",
                "报告",
                "方案",
                "生成",
                "输出",
            )
        )
        markdown_shape = stripped.startswith(("# ", "## ")) or "\n## " in stripped or "\n```" in stripped
        return file_intent and (markdown_shape or len(stripped) >= 300)

    @staticmethod
    def _wants_artifact(prompt: str) -> bool:
        prompt_lower = prompt.lower()
        return any(
            marker in prompt_lower
            for marker in (
                "html",
                "markdown",
                " md",
                ".md",
                "文件",
                "文档",
                "报告",
                "方案",
                "演示文稿",
                "ppt",
                "生成",
                "输出",
            )
        )

    @staticmethod
    def _normalize_artifact_markdown(content: str) -> str:
        stripped = content.strip()
        lowered = stripped.lower()
        if lowered.startswith(("<!doctype html", "<html")):
            return stripped
        return stripped

    @staticmethod
    def _extract_fenced_artifacts(content: str) -> list[tuple[str, str, str]]:
        artifacts: list[tuple[str, str, str]] = []
        counts: dict[str, int] = {}
        for match in re.finditer(r"```([a-zA-Z0-9_-]+)?\s*\n(.*?)\n```", content, re.DOTALL):
            lang = (match.group(1) or "markdown").lower()
            body = match.group(2).strip()
            if not body:
                continue
            if lang in {"html", "htm"}:
                title = "HTML 演示文稿"
                filename = "html-presentation.md"
                markdown = body
            elif lang in {"markdown", "md"}:
                title = "Markdown 总结文件"
                filename = "summary.md"
                markdown = body
            else:
                title = f"{lang} artifact"
                filename = f"{lang}-artifact.md"
                markdown = f"```{lang}\n{body}\n```"

            counts[filename] = counts.get(filename, 0) + 1
            if counts[filename] > 1:
                stem, suffix = filename.rsplit(".", 1)
                filename = f"{stem}-{counts[filename]}.{suffix}"
            artifacts.append((title, filename, markdown))
        return artifacts

    @staticmethod
    def _fallback_title(prompt: str) -> str:
        normalized = "".join(ch if ch.isalnum() else "-" for ch in prompt.strip().lower())
        normalized = "-".join(part for part in normalized.split("-") if part)
        if not normalized:
            return "agent-artifact"
        return normalized[:80].strip("-") or "agent-artifact"
