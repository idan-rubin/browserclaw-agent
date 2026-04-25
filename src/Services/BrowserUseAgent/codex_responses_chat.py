from __future__ import annotations

import json
import re
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel

from browser_use.llm.exceptions import ModelProviderError
from browser_use.llm.messages import BaseMessage, SystemMessage, UserMessage
from browser_use.llm.views import ChatInvokeCompletion, ChatInvokeUsage

T = TypeVar("T", bound=BaseModel)

PROVIDER_NAME = "openai-oauth"
CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses"
DEFAULT_TIMEOUT_S = 120.0
MAX_ERROR_BODY = 300
JSON_FENCE_RE = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.DOTALL)

JSON_OUTPUT_INSTRUCTION = (
    "\n\nReturn ONLY a JSON object that matches this schema, with no prose, "
    "no markdown fences, no explanation:\n"
)


def _content_parts(content: Any) -> list[dict[str, Any]]:
    """Normalize a browser-use message body into Codex Responses input parts.

    Returns a list of typed parts (`input_text` / `input_image`). Strings,
    None, and unknown shapes are coerced into a single text part.
    """
    if content is None or content == "":
        return []
    if isinstance(content, str):
        return [{"type": "input_text", "text": content}]
    if isinstance(content, list):
        parts: list[dict[str, Any]] = []
        for p in content:
            text = getattr(p, "text", None)
            if text:
                parts.append({"type": "input_text", "text": text})
                continue
            image = getattr(p, "image_url", None)
            if image is None:
                continue
            url = getattr(image, "url", None) if not isinstance(image, str) else image
            if url:
                parts.append({"type": "input_image", "image_url": url})
        return parts
    return [{"type": "input_text", "text": str(content)}]


def _content_text(content: Any) -> str:
    return "\n".join(p["text"] for p in _content_parts(content) if p["type"] == "input_text")


def _content_payload(content: Any) -> str | list[dict[str, Any]]:
    parts = _content_parts(content)
    if not parts:
        return ""
    if len(parts) == 1 and parts[0]["type"] == "input_text":
        return parts[0]["text"]
    return parts


def _strip_json_fence(text: str) -> str:
    m = JSON_FENCE_RE.match(text.strip())
    return m.group(1) if m else text


class CodexResponsesChat:
    """browser-use BaseChatModel adapter for the Codex Responses API.

    Mirrors browserclaw-agent's openai-oauth provider: posts the same
    request shape to chatgpt.com/backend-api/codex/responses and reads
    the SSE stream. Stateless on auth — the caller supplies a fresh OAuth
    bearer per request.
    """

    def __init__(self, model: str, api_key: str, reasoning_effort: str = "low") -> None:
        self.model = model
        self.api_key = api_key
        self.reasoning_effort = reasoning_effort
        self.total_prompt_tokens: int = 0
        self.total_completion_tokens: int = 0

    @property
    def provider(self) -> str:
        return PROVIDER_NAME

    @property
    def name(self) -> str:
        return PROVIDER_NAME

    @property
    def model_name(self) -> str:
        return self.model

    async def ainvoke(
        self,
        messages: list[BaseMessage],
        output_format: type[T] | None = None,
        **_: Any,
    ) -> ChatInvokeCompletion[Any]:
        instructions, input_items = self._build_input(messages, output_format)
        body = self._build_body(instructions, input_items)

        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT_S) as client:
            response = await client.post(CODEX_RESPONSES_URL, json=body, headers=self._headers())

        if response.status_code != 200:
            raise self._error(f"Codex Responses {response.status_code}: {response.text[:MAX_ERROR_BODY]}", response.status_code)

        text, usage = self._parse_stream(response.text)
        self.total_prompt_tokens += usage.prompt_tokens
        self.total_completion_tokens += usage.completion_tokens

        if output_format is None:
            return ChatInvokeCompletion(completion=text, usage=usage)

        try:
            parsed = output_format.model_validate_json(_strip_json_fence(text))
        except Exception as err:
            raise self._error(f"Codex Responses returned non-JSON for structured output: {err}", 502) from err
        return ChatInvokeCompletion(completion=parsed, usage=usage)

    def _build_input(
        self,
        messages: list[BaseMessage],
        output_format: type[T] | None,
    ) -> tuple[str, list[dict[str, Any]]]:
        instructions: list[str] = []
        input_items: list[dict[str, Any]] = []
        for m in messages:
            if isinstance(m, SystemMessage):
                instructions.append(_content_text(m.content))
                continue
            role = "user" if isinstance(m, UserMessage) else "assistant"
            input_items.append({"role": role, "content": _content_payload(m.content)})
        instruction_text = "\n\n".join(s for s in instructions if s)
        if output_format is not None:
            instruction_text += JSON_OUTPUT_INSTRUCTION + json.dumps(output_format.model_json_schema())
        return instruction_text, input_items

    def _build_body(self, instructions: str, input_items: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "model": self.model,
            "instructions": instructions,
            "input": input_items,
            "store": False,
            "stream": True,
            "reasoning": {"effort": self.reasoning_effort},
        }

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "originator": "openclaw",
            "User-Agent": "openclaw/1.0",
        }

    def _error(self, message: str, status_code: int) -> ModelProviderError:
        return ModelProviderError(message=message, status_code=status_code, model=self.name)

    def _parse_stream(self, body: str) -> tuple[str, ChatInvokeUsage]:
        text_parts: list[str] = []
        prompt_tokens = 0
        completion_tokens = 0
        saw_completed = False
        for line in body.split("\n"):
            if not line.startswith("data: "):
                continue
            try:
                event = json.loads(line[6:])
            except json.JSONDecodeError:
                continue
            kind = event.get("type")
            if kind == "response.output_text.done":
                fragment = event.get("text")
                if fragment:
                    text_parts.append(fragment)
            elif kind == "response.completed":
                saw_completed = True
                resp = event.get("response") or {}
                usage_data = resp.get("usage") or {}
                prompt_tokens = int(usage_data.get("input_tokens") or 0)
                completion_tokens = int(usage_data.get("output_tokens") or 0)
                if not text_parts:
                    text_parts.extend(self._fallback_text(resp))

        if not saw_completed:
            raise self._error("Codex Responses stream ended without response.completed event", 502)
        text = "".join(text_parts)
        if not text:
            raise self._error(
                "Codex Responses stream completed with no model text (refusal or malformed payload)",
                502,
            )
        return text, ChatInvokeUsage(
            prompt_tokens=prompt_tokens,
            prompt_cached_tokens=None,
            prompt_cache_creation_tokens=None,
            prompt_image_tokens=None,
            completion_tokens=completion_tokens,
            total_tokens=prompt_tokens + completion_tokens,
        )

    @staticmethod
    def _fallback_text(response: dict[str, Any]) -> list[str]:
        out: list[str] = []
        for output in response.get("output") or []:
            for piece in output.get("content") or []:
                text = piece.get("text")
                if text:
                    out.append(text)
        return out
