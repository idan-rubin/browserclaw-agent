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

CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses"
DEFAULT_TIMEOUT_S = 120.0
JSON_FENCE_RE = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.DOTALL)


def _flatten_content(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(getattr(p, "text", "") for p in content if getattr(p, "text", None))
    return str(content)


def _serialize_content(content: Any) -> str | list[dict[str, Any]]:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[dict[str, Any]] = []
        for p in content:
            text = getattr(p, "text", None)
            if text:
                parts.append({"type": "input_text", "text": text})
                continue
            image_url = getattr(p, "image_url", None)
            if image_url is not None:
                url = getattr(image_url, "url", None) or (image_url if isinstance(image_url, str) else None)
                if url:
                    parts.append({"type": "input_image", "image_url": url})
        if not parts:
            return ""
        if len(parts) == 1 and parts[0]["type"] == "input_text":
            return parts[0]["text"]
        return parts
    return str(content)


def _strip_json_fence(text: str) -> str:
    m = JSON_FENCE_RE.match(text.strip())
    return m.group(1) if m else text


class CodexResponsesChat:
    def __init__(self, model: str, api_key: str, reasoning_effort: str = "low") -> None:
        self.model = model
        self.api_key = api_key
        self.reasoning_effort = reasoning_effort
        self.total_prompt_tokens: int = 0
        self.total_completion_tokens: int = 0

    @property
    def provider(self) -> str:
        return "openai-oauth"

    @property
    def name(self) -> str:
        return "openai-oauth"

    @property
    def model_name(self) -> str:
        return self.model

    def _serialize_messages(self, messages: list[BaseMessage]) -> tuple[str, list[dict[str, Any]]]:
        instructions_parts: list[str] = []
        input_items: list[dict[str, Any]] = []
        for m in messages:
            if isinstance(m, SystemMessage):
                instructions_parts.append(_flatten_content(m.content))
            else:
                role = "user" if isinstance(m, UserMessage) else "assistant"
                input_items.append({"role": role, "content": _serialize_content(m.content)})
        return "\n\n".join(instructions_parts), input_items

    async def ainvoke(
        self,
        messages: list[BaseMessage],
        output_format: type[T] | None = None,
        **_: Any,
    ) -> ChatInvokeCompletion[Any]:
        instructions, input_items = self._serialize_messages(messages)
        if output_format is not None:
            schema = output_format.model_json_schema()
            instructions += (
                "\n\nReturn ONLY a JSON object that matches this schema, with no prose, "
                "no markdown fences, no explanation:\n" + json.dumps(schema)
            )

        body = {
            "model": self.model,
            "instructions": instructions,
            "input": input_items,
            "store": False,
            "stream": True,
            "reasoning": {"effort": self.reasoning_effort},
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "originator": "openclaw",
            "User-Agent": "openclaw/1.0",
        }

        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT_S) as client:
            response = await client.post(CODEX_RESPONSES_URL, json=body, headers=headers)

        if response.status_code != 200:
            raise ModelProviderError(
                message=f"Codex Responses {response.status_code}: {response.text[:300]}",
                status_code=response.status_code,
                model=self.name,
            )

        text, usage_in, usage_out = self._parse_sse_body(response.text)
        self.total_prompt_tokens += usage_in
        self.total_completion_tokens += usage_out
        usage = ChatInvokeUsage(
            prompt_tokens=usage_in,
            prompt_cached_tokens=None,
            prompt_cache_creation_tokens=None,
            prompt_image_tokens=None,
            completion_tokens=usage_out,
            total_tokens=usage_in + usage_out,
        )

        if output_format is None:
            return ChatInvokeCompletion(completion=text, usage=usage)

        try:
            parsed = output_format.model_validate_json(_strip_json_fence(text))
        except Exception as err:
            raise ModelProviderError(
                message=f"Codex Responses returned non-JSON for structured output: {err}",
                status_code=502,
                model=self.name,
            ) from err
        return ChatInvokeCompletion(completion=parsed, usage=usage)

    @staticmethod
    def _parse_sse_body(body: str) -> tuple[str, int, int]:
        text_parts: list[str] = []
        usage_in = 0
        usage_out = 0
        saw_completed = False
        for line in body.split("\n"):
            if not line.startswith("data: "):
                continue
            try:
                event = json.loads(line[6:])
            except json.JSONDecodeError:
                continue
            event_type = event.get("type")
            if event_type == "response.output_text.done":
                fragment = event.get("text")
                if fragment:
                    text_parts.append(fragment)
            elif event_type == "response.completed":
                saw_completed = True
                resp = event.get("response") or {}
                usage = resp.get("usage") or {}
                usage_in = int(usage.get("input_tokens") or 0)
                usage_out = int(usage.get("output_tokens") or 0)
                outputs = resp.get("output") or []
                if outputs:
                    contents = outputs[0].get("content") or []
                    if contents:
                        legacy = contents[0].get("text")
                        if legacy and not text_parts:
                            text_parts.append(legacy)

        if not saw_completed:
            raise ModelProviderError(
                message="Codex Responses stream ended without response.completed event",
                status_code=502,
                model="openai-oauth",
            )
        text = "".join(text_parts)
        if not text:
            raise ModelProviderError(
                message="Codex Responses stream completed with no model text (refusal or malformed payload)",
                status_code=502,
                model="openai-oauth",
            )
        return text, usage_in, usage_out
