"""Tenant-facing API (authenticated with a tenant API key)."""
import asyncio
import json
import logging
import time
import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from fastapi.responses import JSONResponse, StreamingResponse

from app import cache, config, jobs, llm, ratelimit, store, tenants
from app.auth import get_tenant
from app.ratelimit import rate_limit
from app.schemas import ChatCompletionRequest, CreateKey, JobRequest

router = APIRouter(prefix="/v1", tags=["tenant"])
log = logging.getLogger("gateway")

RangeKey = Literal["1h", "24h", "7d"]
StatusFilter = Literal["queued", "processing", "done", "failed", "cached"]


def _render(messages: list[dict]) -> str:
    if len(messages) == 1 and messages[0]["role"] == "user":
        return messages[0]["content"]
    return "\n\n".join(f"[{m['role']}] {m['content']}" for m in messages)


def _limit_headers(response: Response) -> dict:
    return {k: v for k, v in response.headers.items() if k.lower().startswith("x-ratelimit")}


@router.get("/me")
async def me(tenant: dict = Depends(get_tenant)):
    used = await ratelimit.current_usage(tenant["id"])
    return {
        "tenant": {"id": tenant["id"], "name": tenant["name"]},
        "key": {"id": tenant["key_id"], "name": tenant["key_name"], "prefix": tenant["key_prefix"]},
        "rate_limit": {"per_minute": tenant["rate_limit_per_min"], "used_this_minute": used},
        "defaults": {
            "model": config.LLM_MODEL,
            "max_tokens": config.DEFAULT_MAX_TOKENS,
            "max_tokens_cap": config.MAX_TOKENS_CAP,
            "cache_ttl_s": config.CACHE_TTL_S,
        },
    }


@router.get("/models")
async def models(_: dict = Depends(get_tenant)):
    return {
        "object": "list",
        "data": [{"id": m, "object": "model", "owned_by": "gateway"} for m in config.ALLOWED_MODELS],
    }


def _replay(existing: dict, prompt: str, model: str, max_tokens: int, response: Response) -> dict:
    """Answer a retried submit with the job created by the first attempt."""
    if (existing["prompt"], existing["model"], existing["max_tokens"]) != (prompt, model, max_tokens):
        raise HTTPException(
            status_code=422, detail="Idempotency-Key was already used with a different request"
        )
    response.status_code = 200
    response.headers["Idempotent-Replayed"] = "true"
    return {"job_id": existing["id"], "status": existing["status"], "cached": existing["cached"]}


@router.post("/jobs", status_code=202)
async def submit_job(
    req: JobRequest,
    response: Response,
    tenant: dict = Depends(rate_limit),
    idempotency_key: str | None = Header(default=None, max_length=255),
):
    """Queue a prompt for async processing. Cache hits complete immediately.

    Send an `Idempotency-Key` header to make retries safe: repeating a request with
    the same key returns the original job instead of creating a new one.
    """
    model, max_tokens = req.resolved()
    messages = [{"role": "user", "content": req.prompt}]
    key = idempotency_key.strip() if idempotency_key else None

    if key and (existing := await store.find_by_idempotency_key(tenant["id"], key)):
        return _replay(existing, req.prompt, model, max_tokens, response)

    job_id = uuid.uuid4().hex
    base = dict(
        id=job_id, tenant_id=tenant["id"], api_key_id=tenant["key_id"], kind="async",
        model=model, max_tokens=max_tokens, prompt=req.prompt, idempotency_key=key,
    )

    started = time.perf_counter()
    hit = await cache.get_cached(tenant["id"], model, messages, max_tokens)
    if hit:
        inserted = await store.insert_request(
            **base, status="done", cached=True, result=hit["content"],
            prompt_tokens=hit.get("prompt_tokens"), completion_tokens=hit.get("completion_tokens"),
            latency_ms=int((time.perf_counter() - started) * 1000), finished=True,
            provider=hit.get("provider"),
        )
        if not inserted:  # lost a race with a concurrent request using the same key
            return _replay(await store.find_by_idempotency_key(tenant["id"], key),
                           req.prompt, model, max_tokens, response)
        response.status_code = 200
        response.headers["X-Cache"] = "HIT"
        return {"job_id": job_id, "status": "done", "cached": True}

    # Outbox: the row is the durable record; Kafka is told afterwards.
    if not await store.insert_request(**base, status="queued"):
        return _replay(await store.find_by_idempotency_key(tenant["id"], key),
                       req.prompt, model, max_tokens, response)
    try:
        # Bounded: with the broker down we still answer fast; the row is durable.
        await asyncio.wait_for(jobs.publish(job_id, tenant["id"]), timeout=3)
    except Exception as exc:  # noqa: BLE001 - the sweeper relays it once Kafka is back
        log.warning(json.dumps({"msg": "publish deferred to outbox relay", "job_id": job_id,
                                "error": repr(exc)[:200]}))
    response.headers["X-Cache"] = "MISS"
    return {"job_id": job_id, "status": "queued", "cached": False}


@router.get("/jobs")
async def list_jobs(
    tenant: dict = Depends(get_tenant),
    status: StatusFilter | None = None,
    q: str | None = Query(default=None, max_length=200),
    before: datetime | None = None,
    limit: int = Query(default=50, ge=1, le=200),
):
    items = await store.list_requests(
        tenant_id=tenant["id"], status=status, q=q, before=before, limit=limit
    )
    next_cursor = items[-1]["created_at"] if len(items) == limit else None
    return {"data": items, "next_cursor": next_cursor}


@router.get("/jobs/{job_id}")
async def job_status(job_id: str, tenant: dict = Depends(get_tenant)):
    job = await store.get_request(job_id, tenant["id"])
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.post("/chat/completions")
async def chat_completions(
    req: ChatCompletionRequest, response: Response, tenant: dict = Depends(rate_limit)
):
    """OpenAI-compatible completion. `stream: true` returns server-sent events."""
    model, max_tokens = req.resolved()
    messages = [m.model_dump() for m in req.messages]
    request_id = uuid.uuid4().hex
    base = dict(
        id=request_id, tenant_id=tenant["id"], api_key_id=tenant["key_id"],
        kind="stream" if req.stream else "sync",
        model=model, max_tokens=max_tokens, prompt=_render(messages),
    )
    started = time.perf_counter()
    hit = await cache.get_cached(tenant["id"], model, messages, max_tokens)

    if req.stream:
        headers = _limit_headers(response) | {
            "X-Cache": "HIT" if hit else "MISS",
            "X-Gateway-Request-ID": request_id,
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # tell nginx not to buffer the stream
        }
        return StreamingResponse(
            _stream(base, tenant["id"], messages, model, max_tokens, hit, started),
            media_type="text/event-stream", headers=headers,
        )

    out = hit
    if out is None:
        try:
            out = await llm.router.complete(messages, model, max_tokens)
        except (llm.RetryableError, llm.FatalError) as exc:
            status = 503 if isinstance(exc, llm.RetryableError) else 502
            await store.insert_request(
                **base, status="failed", error=str(exc)[:300],
                latency_ms=int((time.perf_counter() - started) * 1000), finished=True,
            )
            return JSONResponse(
                status_code=status, headers=_limit_headers(response),
                content={"error": {"message": str(exc), "type": "upstream_error", "id": request_id}},
            )
        await cache.set_cached(tenant["id"], model, messages, max_tokens, out)

    cached = hit is not None
    await store.insert_request(
        **base, status="done", cached=cached, result=out["content"],
        prompt_tokens=out.get("prompt_tokens"), completion_tokens=out.get("completion_tokens"),
        latency_ms=int((time.perf_counter() - started) * 1000) if cached else out["latency_ms"],
        finished=True, provider=out.get("provider"),
    )
    response.headers["X-Cache"] = "HIT" if cached else "MISS"
    pt, ct = out.get("prompt_tokens") or 0, out.get("completion_tokens") or 0
    return {
        "id": f"chatcmpl-{request_id}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": out["content"]},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": pt, "completion_tokens": ct, "total_tokens": pt + ct},
        "x_gateway": {"cached": cached, "request_id": request_id, "provider": out.get("provider")},
    }


async def _stream(base: dict, tenant_id: int, messages: list[dict], model: str,
                  max_tokens: int, hit: dict | None, started: float):
    """Relay upstream tokens as OpenAI-style chunks, then record the request."""
    created = int(time.time())
    cid = f"chatcmpl-{base['id']}"

    def event(payload: dict) -> str:
        return f"data: {json.dumps(payload)}\n\n"

    def chunk(delta: dict, finish: str | None = None) -> str:
        return event({"id": cid, "object": "chat.completion.chunk", "created": created,
                      "model": model,
                      "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]})

    parts: list[str] = []
    usage: dict = {}
    provider = hit.get("provider") if hit else None
    ttft_ms = None
    status, error = "done", None
    try:
        yield chunk({"role": "assistant"})
        if hit:
            ttft_ms = int((time.perf_counter() - started) * 1000)
            parts.append(hit["content"])
            usage = {"prompt_tokens": hit.get("prompt_tokens"),
                     "completion_tokens": hit.get("completion_tokens")}
            yield chunk({"content": hit["content"]})
        else:
            async for kind, value in llm.router.stream(messages, model, max_tokens):
                if kind == "provider":
                    provider = value
                elif kind == "delta":
                    if ttft_ms is None:
                        ttft_ms = int((time.perf_counter() - started) * 1000)
                    parts.append(value)
                    yield chunk({"content": value})
                elif kind == "usage":
                    usage = value
        pt, ct = usage.get("prompt_tokens") or 0, usage.get("completion_tokens") or 0
        yield chunk({}, "stop")
        yield event({"id": cid, "object": "chat.completion.chunk", "created": created,
                     "model": model, "choices": [],
                     "usage": {"prompt_tokens": pt, "completion_tokens": ct, "total_tokens": pt + ct},
                     "x_gateway": {"cached": hit is not None, "request_id": base["id"],
                                   "provider": provider, "ttft_ms": ttft_ms}})
        yield "data: [DONE]\n\n"
    except (llm.RetryableError, llm.FatalError) as exc:
        status, error = "failed", str(exc)[:300]
        yield event({"error": {"message": str(exc), "type": "upstream_error", "id": base["id"]}})
        yield "data: [DONE]\n\n"
    except (asyncio.CancelledError, GeneratorExit):
        status, error = "failed", "client disconnected mid-stream"
        raise
    finally:
        content = "".join(parts)
        record = store.insert_request(
            **base, status=status, cached=hit is not None, result=content or None, error=error,
            prompt_tokens=usage.get("prompt_tokens"), completion_tokens=usage.get("completion_tokens"),
            latency_ms=int((time.perf_counter() - started) * 1000), finished=True,
            provider=provider, ttft_ms=ttft_ms,
        )
        # Shield the bookkeeping so a disconnect cannot cancel it half-way.
        await asyncio.shield(record)
        if status == "done" and hit is None and content:
            await asyncio.shield(cache.set_cached(tenant_id, model, messages, max_tokens, {
                "content": content, "prompt_tokens": usage.get("prompt_tokens"),
                "completion_tokens": usage.get("completion_tokens"), "provider": provider,
                "latency_ms": int((time.perf_counter() - started) * 1000),
            }))


@router.get("/usage")
async def usage(range: RangeKey = "24h", tenant: dict = Depends(get_tenant)):
    data = await store.usage([tenant["id"]], range)
    data["models"] = await store.model_breakdown(tenant["id"], range)
    return data


@router.get("/keys")
async def list_keys(tenant: dict = Depends(get_tenant)):
    return {"data": await tenants.list_keys(tenant["id"]), "current_key_id": tenant["key_id"]}


@router.post("/keys", status_code=201)
async def create_key(body: CreateKey, tenant: dict = Depends(get_tenant)):
    return await tenants.create_key(tenant["id"], body.name)


@router.delete("/keys/{key_id}")
async def revoke_key(key_id: int, tenant: dict = Depends(get_tenant)):
    if key_id == tenant["key_id"]:
        raise HTTPException(status_code=409, detail="Cannot revoke the key used for this request")
    key = await tenants.revoke_key(key_id, tenant["id"])
    if key is None:
        raise HTTPException(status_code=404, detail="Key not found")
    return key
