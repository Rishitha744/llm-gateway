"""Dependency health checks and worker fleet status."""
import asyncio
import json
import time

from app import config, db, jobs, llm, store, sweeper
from app.redis_client import r

STARTED_AT = time.time()


async def _timed(name: str, coro):
    started = time.perf_counter()
    try:
        ok = await asyncio.wait_for(coro, timeout=2.5)
        error = None if ok else "check failed"
    except Exception as exc:  # noqa: BLE001 - health checks report, never raise
        ok, error = False, repr(exc)[:200]
    return {
        "name": name,
        "ok": bool(ok),
        "latency_ms": round((time.perf_counter() - started) * 1000, 1),
        "error": error,
    }


async def _pg():
    async with db.pool.acquire() as conn:
        return await conn.fetchval("SELECT 1") == 1


async def _redis():
    return await r.ping()


async def readiness() -> list[dict]:
    return list(
        await asyncio.gather(
            _timed("postgres", _pg()),
            _timed("redis", _redis()),
            _timed("kafka", jobs.kafka_ok()),
        )
    )


async def workers() -> list[dict]:
    out = []
    async for key in r.scan_iter(match="worker:*", count=100):
        raw = await r.get(key)
        if raw:
            out.append(json.loads(raw))
    return sorted(out, key=lambda w: w.get("id", ""))


async def snapshot() -> dict:
    deps = await readiness()
    providers = await llm.router.status()
    deps.append({
        "name": "llm_upstream",
        "ok": any(p["reachable"] and p["circuit"] != "open" for p in providers),
        "latency_ms": min((p["latency_ms"] for p in providers), default=0),
        "error": None if providers else "no providers configured",
    })
    return {
        "instance": config.INSTANCE_ID,
        "uptime_s": int(time.time() - STARTED_AT),
        "dependencies": deps,
        "workers": await workers(),
        "queue": await store.queue_depth(),
        "providers": providers,
        "sweeper": await sweeper.stats(),
        "config": {
            "llm_base_url": providers[0]["base_url"] if providers else None,
            "default_model": config.LLM_MODEL,
            "models": config.ALLOWED_MODELS,
            "cache_ttl_s": config.CACHE_TTL_S,
            "max_tokens_cap": config.MAX_TOKENS_CAP,
        },
    }
