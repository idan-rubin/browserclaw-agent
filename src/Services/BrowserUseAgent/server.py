"""
browser-use sidecar.

A thin FastAPI wrapper around browser_use.Agent that mirrors the HTTP +
SSE contract of the Browser service, so frontend code can talk to either
backend through the same event envelope. BYOK only; no server-side keys.

Contract:
  POST   /api/v1/sessions           -> { session_id, status, created_at }
  GET    /api/v1/sessions/{id}/stream  -> text/event-stream
  DELETE /api/v1/sessions/{id}      -> { success }
  GET    /health                    -> { status, sessions }

Events:
  connected   { session_id }
  step        { step, action, reasoning, url, page_title }
  tokens      { input, output, total }
  completed   { answer, steps_completed, duration_ms, llm_calls }
  failed      { step, error }
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import secrets
import subprocess
import time
from dataclasses import dataclass, field
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from browser_use import Agent, BrowserProfile, BrowserSession
from browser_use.llm import ChatAnthropic, ChatGoogle, ChatGroq, ChatOpenAI

from codex_responses_chat import CodexResponsesChat

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
log = logging.getLogger("browser-use-sidecar")

MAX_STEPS = int(os.environ.get("BU_MAX_STEPS", "100"))
CDP_HOST = os.environ.get("BU_CDP_HOST", "127.0.0.1")
CDP_PORT = int(os.environ.get("BU_CDP_PORT", "9222"))
CDP_URL = f"http://{CDP_HOST}:{CDP_PORT}"
CHROME_RESTART_TIMEOUT_S = 20.0
INTERNAL_TOKEN = os.environ.get("BROWSER_INTERNAL_TOKEN", "")
if INTERNAL_TOKEN == "":
    raise RuntimeError("BROWSER_INTERNAL_TOKEN must be set")


_SENSITIVE_RE = re.compile(
    r"(eyJ[A-Za-z0-9_-]{20,}"
    r"|sk-[A-Za-z0-9]{20,}"
    r"|gsk_[A-Za-z0-9]{20,}"
    r"|xox[bpas]-[A-Za-z0-9-]{20,}"
    r"|AIza[A-Za-z0-9_-]{20,}"
    r"|ghp_[A-Za-z0-9]{20,}"
    r"|[A-Za-z0-9+/]{40,}={0,2})"
)


def sanitize_error(text: str) -> str:
    return _SENSITIVE_RE.sub("[REDACTED]", text)[:500]


def require_token(authorization: str = Header(default="")) -> None:
    prefix = "Bearer "
    token = authorization[len(prefix):] if authorization.startswith(prefix) else ""
    if not secrets.compare_digest(token, INTERNAL_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid or missing internal token")

# ── LLM provider factory ─────────────────────────────────────────────────────

PROVIDERS = {
    "anthropic": ChatAnthropic,
    "openai": ChatOpenAI,
    "openai-oauth": CodexResponsesChat,
    "gemini": ChatGoogle,
    "groq": ChatGroq,
}


def make_llm(provider: str, model: str, api_key: str):
    cls = PROVIDERS.get(provider)
    if cls is None:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported provider '{provider}'. Must be one of: {sorted(PROVIDERS)}",
        )
    return cls(model=model, api_key=api_key)


# ── Session state ────────────────────────────────────────────────────────────


@dataclass
class Session:
    id: str
    prompt: str
    created_at: float
    queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    task: asyncio.Task | None = None
    agent: Agent | None = None
    status: str = "pending"  # pending | running | completed | failed
    step_count: int = 0
    terminated: bool = False


SESSIONS: dict[str, Session] = {}


def snapshot_tokens(agent: Agent | None) -> dict[str, int]:
    if agent is None:
        return {"input": 0, "output": 0, "total": 0}
    tc = getattr(agent, "token_cost", None)
    if tc is None:
        return {"input": 0, "output": 0, "total": 0}

    for method_name in ("get_usage_summary", "usage_summary", "summary"):
        method = getattr(tc, method_name, None)
        if callable(method):
            try:
                summary = method()
                inp = int(getattr(summary, "total_prompt_tokens", 0) or 0)
                out = int(getattr(summary, "total_completion_tokens", 0) or 0)
                return {"input": inp, "output": out, "total": inp + out}
            except Exception:
                pass

    history = getattr(tc, "_usage_history", None) or getattr(tc, "usage_history", None) or []
    inp = 0
    out = 0
    for entry in history:
        inp += int(getattr(entry, "prompt_tokens", 0) or 0)
        out += int(getattr(entry, "completion_tokens", 0) or 0)
    if not history:
        log.warning(
            "snapshot_tokens: no readable token source on browser-use TokenCost "
            "(checked get_usage_summary/usage_summary/summary/_usage_history/usage_history)"
        )
    return {"input": inp, "output": out, "total": inp + out}


async def emit(session: Session, event: str, data: dict[str, Any]) -> None:
    await session.queue.put((event, data))


async def wait_for_cdp(timeout_s: float = CHROME_RESTART_TIMEOUT_S) -> None:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(CDP_HOST, CDP_PORT), timeout=1.0
            )
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
            return
        except (OSError, asyncio.TimeoutError):
            await asyncio.sleep(0.25)
    raise RuntimeError(f"Chrome CDP not reachable at {CDP_HOST}:{CDP_PORT} within {timeout_s}s")


async def reset_chrome() -> None:
    try:
        subprocess.run(["pkill", "-9", "-f", "/usr/bin/chromium"], check=False, timeout=5.0)
    except (FileNotFoundError, subprocess.TimeoutExpired) as err:
        log.warning("pkill failed: %s", err)
    await asyncio.sleep(0.3)
    await wait_for_cdp()


# ── Request models ───────────────────────────────────────────────────────────


class LlmConfig(BaseModel):
    provider: str
    model: str
    api_key: str


class CreateSessionRequest(BaseModel):
    prompt: str = Field(min_length=1)
    skip_moderation: bool | None = None
    skip_postprocessing: bool | None = None
    llm_config: LlmConfig | None = None


# ── Agent runner ─────────────────────────────────────────────────────────────


async def run_agent(session: Session, llm_config: LlmConfig) -> None:
    session.status = "running"
    start = time.time()
    try:
        try:
            await reset_chrome()
        except Exception as err:  # noqa: BLE001
            log.error("reset_chrome failed: %s: %s", type(err).__name__, err)
            session.status = "failed"
            await emit(
                session,
                "failed",
                {"step": 0, "error": "Chrome reset failed — sidecar may need restart"},
            )
            return

        llm = make_llm(llm_config.provider, llm_config.model, llm_config.api_key)

        browser = BrowserSession(
            browser_profile=BrowserProfile(cdp_url=CDP_URL, is_local=True),
        )

        async def on_step(state, agent_output, step_num: int):
            if session.terminated:
                return
            session.step_count = step_num
            actions = getattr(agent_output, "action", None) or []
            first_action = actions[0] if actions else None
            action_name = "think"
            if first_action is not None:
                fields_set = getattr(first_action, "model_fields_set", None) or set()
                for name in fields_set:
                    if getattr(first_action, name, None) is not None:
                        action_name = name
                        break
            reasoning = ""
            current_state = getattr(agent_output, "current_state", None)
            if current_state is not None:
                reasoning = getattr(current_state, "next_goal", "") or getattr(
                    current_state, "evaluation_previous_goal", ""
                )
            await emit(
                session,
                "step",
                {
                    "step": step_num,
                    "action": action_name,
                    "reasoning": reasoning,
                    "url": getattr(state, "url", "") or "",
                    "page_title": getattr(state, "title", "") or "",
                },
            )
            await emit(session, "tokens", snapshot_tokens(session.agent))

        agent = Agent(
            task=session.prompt,
            llm=llm,
            browser_session=browser,
            calculate_cost=True,
            register_new_step_callback=on_step,
        )
        session.agent = agent

        history = await agent.run(max_steps=MAX_STEPS)

        if session.terminated:
            return

        success = bool(history.is_successful())
        final_answer = history.final_result() or ""
        duration_ms = int((time.time() - start) * 1000)
        session.status = "completed" if success else "failed"

        usage = getattr(history, "usage", None)
        if usage is not None:
            await emit(
                session,
                "tokens",
                {
                    "input": int(getattr(usage, "total_prompt_tokens", 0) or 0),
                    "output": int(getattr(usage, "total_completion_tokens", 0) or 0),
                    "total": int(getattr(usage, "total_tokens", 0) or 0),
                },
            )

        if success:
            await emit(
                session,
                "completed",
                {
                    "answer": final_answer,
                    "steps_completed": session.step_count,
                    "duration_ms": duration_ms,
                    "llm_calls": int(getattr(usage, "entry_count", 0) or 0) if usage else 0,
                    "skills_used": False,
                    "skill_outcome": "none",
                    "domain": None,
                },
            )
        else:
            await emit(
                session,
                "failed",
                {
                    "step": session.step_count,
                    "error": final_answer or "Agent did not complete successfully",
                    "llm_calls": int(getattr(usage, "entry_count", 0) or 0) if usage else 0,
                },
            )
    except asyncio.CancelledError:
        session.status = "failed"
        await emit(session, "failed", {"step": session.step_count, "error": "Run cancelled"})
        raise
    except Exception as err:  # noqa: BLE001
        safe_msg = sanitize_error(str(err))
        log.error("Agent run crashed: %s: %s", type(err).__name__, safe_msg)
        session.status = "failed"
        await emit(
            session,
            "failed",
            {"step": session.step_count, "error": f"{type(err).__name__}: {safe_msg}"},
        )
    finally:
        await session.queue.put(("__end__", {}))


# ── HTTP app ─────────────────────────────────────────────────────────────────

app = FastAPI(title="browser-use sidecar")


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse(
        {
            "status": "healthy",
            "service": "browser-use-sidecar",
        }
    )


@app.post("/api/v1/sessions", dependencies=[Depends(require_token)])
async def create_session(body: CreateSessionRequest) -> JSONResponse:
    if body.llm_config is None:
        raise HTTPException(status_code=400, detail="llm_config is required (BYOK)")

    for existing_id, existing in list(SESSIONS.items()):
        if existing.status in ("pending", "running"):
            existing.terminated = True
            if existing.task is not None:
                existing.task.cancel()
                try:
                    await asyncio.wait_for(existing.task, timeout=5.0)
                except (asyncio.CancelledError, asyncio.TimeoutError):
                    pass
            SESSIONS.pop(existing_id, None)

    session_id = secrets.token_hex(16)
    session = Session(id=session_id, prompt=body.prompt.strip(), created_at=time.time())
    SESSIONS[session_id] = session

    session.task = asyncio.create_task(run_agent(session, body.llm_config))

    return JSONResponse(
        status_code=201,
        content={
            "session_id": session_id,
            "status": session.status,
            "created_at": session.created_at,
        },
    )


@app.get("/api/v1/sessions/{session_id}/stream", dependencies=[Depends(require_token)])
async def stream(session_id: str, request: Request) -> StreamingResponse:
    session = SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    async def event_generator():
        yield f"event: connected\ndata: {json.dumps({'session_id': session_id})}\n\n"
        heartbeat_interval = 15.0
        last_heartbeat = time.time()
        while True:
            if await request.is_disconnected():
                break
            try:
                event, data = await asyncio.wait_for(session.queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                now = time.time()
                if now - last_heartbeat > heartbeat_interval:
                    yield ": heartbeat\n\n"
                    last_heartbeat = now
                continue
            if event == "__end__":
                break
            yield f"event: {event}\ndata: {json.dumps(data)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.delete("/api/v1/sessions/{session_id}", dependencies=[Depends(require_token)])
async def cancel(session_id: str) -> JSONResponse:
    session = SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    session.terminated = True
    if session.task is not None and not session.task.done():
        session.task.cancel()
    SESSIONS.pop(session_id, None)
    return JSONResponse({"success": True})
