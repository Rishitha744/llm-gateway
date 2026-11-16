"""Unit tests for the circuit breaker and the failover router.

Upstreams are httpx.MockTransport handlers; Redis is fakeredis.
Run with:  pip install -r tests/requirements.txt && pytest -q
"""
import asyncio
import json
import time

import httpx
import pytest
from fakeredis import FakeAsyncRedis

from common.circuit import CircuitBreaker
from common.providers import FatalError, Provider, RetryableError, Router


def run(coro):
    return asyncio.run(coro)


def ok_body(text="hi"):
    return {"choices": [{"message": {"content": text}}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 1}}


def provider(name, handler, models=None):
    return Provider(name=name, base_url=f"http://{name}/v1", models=models,
                    client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))


def failing(status):
    def handler(request):
        handler.calls += 1
        return httpx.Response(status, text="boom")
    handler.calls = 0
    return handler


def succeeding(text="hi"):
    def handler(request):
        handler.calls += 1
        handler.last = json.loads(request.content)
        return httpx.Response(200, json=ok_body(text))
    handler.calls = 0
    return handler


MSG = [{"role": "user", "content": "hello"}]


# ---- circuit breaker -------------------------------------------------------

def test_breaker_opens_after_threshold_and_blocks():
    async def go():
        cb = CircuitBreaker(FakeAsyncRedis(decode_responses=True), "p", threshold=3, cooldown_s=30)
        for _ in range(2):
            await cb.record_failure()
        assert await cb.allow()
        await cb.record_failure()
        assert (await cb.snapshot()).state == "open"
        assert not await cb.allow()
    run(go())


def test_breaker_half_open_allows_single_probe_then_closes_on_success():
    async def go():
        r = FakeAsyncRedis(decode_responses=True)
        cb = CircuitBreaker(r, "p", threshold=1, cooldown_s=30)
        await cb.record_failure()
        await r.set(cb.k_open, str(time.time() - 1))  # cooldown elapsed
        assert (await cb.snapshot()).state == "half_open"
        assert await cb.allow()        # this caller is the probe
        assert not await cb.allow()    # everyone else still waits
        await cb.record_success()
        assert (await cb.snapshot()).state == "closed"
        assert await cb.allow()
    run(go())


def test_breaker_failed_probe_reopens():
    async def go():
        r = FakeAsyncRedis(decode_responses=True)
        cb = CircuitBreaker(r, "p", threshold=5, cooldown_s=30)
        await r.set(cb.k_open, str(time.time() - 1))
        assert await cb.allow()
        await cb.record_failure()      # one failure is enough while half-open
        s = await cb.snapshot()
        assert s.state == "open" and s.trips == 1
    run(go())


# ---- router ------------------------------------------------------------------

def test_router_fails_over_to_next_provider():
    async def go():
        bad, good = failing(503), succeeding("from-b")
        router = Router([provider("a", bad), provider("b", good)],
                        FakeAsyncRedis(decode_responses=True))
        out = await router.complete(MSG, "m", 10)
        assert out["provider"] == "b" and out["content"] == "from-b"
        assert bad.calls == 1 and good.calls == 1
    run(go())


def test_router_skips_open_circuit_without_calling_provider():
    async def go():
        bad, good = failing(500), succeeding()
        router = Router([provider("a", bad), provider("b", good)],
                        FakeAsyncRedis(decode_responses=True), threshold=2)
        for _ in range(2):
            await router.complete(MSG, "m", 10)
        assert bad.calls == 2
        await router.complete(MSG, "m", 10)
        assert bad.calls == 2, "open circuit must short-circuit provider a"
        assert good.calls == 3
    run(go())


def test_router_client_error_is_fatal_and_does_not_fail_over():
    async def go():
        bad, good = failing(400), succeeding()
        router = Router([provider("a", bad), provider("b", good)],
                        FakeAsyncRedis(decode_responses=True))
        with pytest.raises(FatalError):
            await router.complete(MSG, "m", 10)
        assert good.calls == 0
        assert (await router.breakers["a"].snapshot()).failures == 0
    run(go())


def test_router_all_failing_is_retryable():
    async def go():
        router = Router([provider("a", failing(429)), provider("b", failing(502))],
                        FakeAsyncRedis(decode_responses=True))
        with pytest.raises(RetryableError):
            await router.complete(MSG, "m", 10)
    run(go())


def test_router_maps_logical_model_names():
    async def go():
        good = succeeding()
        router = Router([provider("a", good, models={"fast": "vendor-fast-v2"})],
                        FakeAsyncRedis(decode_responses=True))
        await router.complete(MSG, "fast", 10)
        assert good.last["model"] == "vendor-fast-v2"
        with pytest.raises(FatalError):
            await router.complete(MSG, "unknown", 10)
    run(go())


def sse(*chunks):
    body = "".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n"
    return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})


def test_stream_fails_over_before_first_token():
    async def go():
        def good(request):
            return sse({"choices": [{"delta": {"content": "Hel"}}]},
                       {"choices": [{"delta": {"content": "lo"}}]},
                       {"choices": [], "usage": {"prompt_tokens": 2, "completion_tokens": 2}})
        router = Router([provider("a", failing(503)), provider("b", good)],
                        FakeAsyncRedis(decode_responses=True))
        events = [e async for e in router.stream(MSG, "m", 10)]
        assert events[0] == ("provider", "b")
        assert "".join(v for k, v in events if k == "delta") == "Hello"
        assert ("usage", {"prompt_tokens": 2, "completion_tokens": 2}) in events
    run(go())


def test_cache_key_is_stable_and_tenant_scoped():
    from common.cache_key import make_key
    a = make_key(1, "m", [{"role": "user", "content": "x"}], 10)
    assert a == make_key(1, "m", [{"content": "x", "role": "user"}], 10)
    assert a != make_key(2, "m", [{"role": "user", "content": "x"}], 10)
