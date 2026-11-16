"""Multi-provider routing with failover and circuit breaking.

Providers are tried in priority order. A provider is skipped while its circuit is
open. Provider-side failures (transport errors, timeouts, 401/403/408/409/425/429,
5xx) count against the breaker and fail over to the next provider. Other 4xx
responses mean the request itself is bad: they are raised immediately and never
fail over. For streams, failover is only possible before the first token is sent.

Configuration (env):
  LLM_PROVIDERS  JSON list, highest priority first, e.g.
    [{"name": "ollama", "base_url": "http://host.docker.internal:11434/v1",
      "api_key": "ollama", "models": {"llama3.2": "llama3.2"}},
     {"name": "openai", "base_url": "https://api.openai.com/v1",
      "api_key": "sk-...", "models": {"llama3.2": "gpt-4o-mini"}}]
    "models" maps the logical model a tenant requests to the provider's model id;
    omit it to accept every model under its own name.
  Without LLM_PROVIDERS, one provider is built from LLM_BASE_URL / LLM_API_KEY.
"""
import json
import os
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

import httpx

from common.circuit import CircuitBreaker

FAILOVER_STATUS = {401, 403, 408, 409, 425, 429}


class RetryableError(Exception):
    """Every provider failed (or was unavailable). Safe to retry later."""


class FatalError(Exception):
    """The request is invalid for the upstream. Retrying will not help."""


class ProviderError(Exception):
    def __init__(self, message: str, failover: bool):
        super().__init__(message)
        self.failover = failover


@dataclass
class Provider:
    name: str
    base_url: str
    api_key: str = ""
    models: dict[str, str] | None = None
    timeout_s: float = 60
    client: httpx.AsyncClient | None = field(default=None, repr=False)

    def __post_init__(self):
        self.base_url = self.base_url.rstrip("/")
        if self.client is None:
            self.client = httpx.AsyncClient(timeout=httpx.Timeout(self.timeout_s, connect=3.0))

    def supports(self, model: str) -> bool:
        return self.models is None or model in self.models

    def upstream_model(self, model: str) -> str:
        return (self.models or {}).get(model, model)

    @property
    def headers(self) -> dict:
        return {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}

    @staticmethod
    def _check(status: int, body: str):
        if status >= 500 or status in FAILOVER_STATUS:
            raise ProviderError(f"status {status}: {body[:160]}", failover=True)
        if status >= 400:
            raise ProviderError(f"status {status}: {body[:160]}", failover=False)

    async def complete(self, messages: list[dict], model: str, max_tokens: int) -> dict:
        started = time.perf_counter()
        try:
            resp = await self.client.post(
                f"{self.base_url}/chat/completions",
                headers=self.headers,
                json={"model": self.upstream_model(model), "messages": messages,
                      "max_tokens": max_tokens},
            )
        except httpx.HTTPError as exc:
            raise ProviderError(f"transport: {exc!r}"[:200], failover=True) from exc
        self._check(resp.status_code, resp.text)
        body = resp.json()
        usage = body.get("usage") or {}
        return {
            "content": body["choices"][0]["message"]["content"],
            "prompt_tokens": usage.get("prompt_tokens"),
            "completion_tokens": usage.get("completion_tokens"),
            "latency_ms": int((time.perf_counter() - started) * 1000),
        }

    async def stream(self, messages: list[dict], model: str, max_tokens: int
                     ) -> AsyncIterator[tuple[str, object]]:
        """Yield ("delta", text) events and finally ("usage", dict)."""
        payload = {"model": self.upstream_model(model), "messages": messages,
                   "max_tokens": max_tokens, "stream": True,
                   "stream_options": {"include_usage": True}}
        try:
            async with self.client.stream("POST", f"{self.base_url}/chat/completions",
                                          headers=self.headers, json=payload) as resp:
                if resp.status_code >= 400:
                    self._check(resp.status_code, (await resp.aread()).decode(errors="replace"))
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    chunk = json.loads(data)
                    if chunk.get("usage"):
                        yield "usage", chunk["usage"]
                    for choice in chunk.get("choices") or []:
                        text = (choice.get("delta") or {}).get("content")
                        if text:
                            yield "delta", text
        except httpx.HTTPError as exc:
            raise ProviderError(f"transport: {exc!r}"[:200], failover=True) from exc

    async def ping(self) -> bool:
        try:
            resp = await self.client.get(f"{self.base_url}/models", headers=self.headers,
                                         timeout=2.0)
            return resp.status_code < 500
        except httpx.HTTPError:
            return False


def load_providers() -> list[Provider]:
    raw = os.environ.get("LLM_PROVIDERS", "").strip()
    if raw:
        return [Provider(**p) for p in json.loads(raw)]
    return [Provider(name="default", base_url=os.environ["LLM_BASE_URL"],
                     api_key=os.environ.get("LLM_API_KEY", ""),
                     timeout_s=float(os.environ.get("LLM_TIMEOUT_S", "60")))]


class Router:
    def __init__(self, providers: list[Provider], redis, threshold: int = 5,
                 cooldown_s: float = 30):
        if not providers:
            raise ValueError("at least one provider is required")
        self.providers = providers
        self.breakers = {p.name: CircuitBreaker(redis, p.name, threshold, cooldown_s)
                         for p in providers}

    def candidates(self, model: str) -> list[Provider]:
        found = [p for p in self.providers if p.supports(model)]
        if not found:
            raise FatalError(f"no provider serves model {model!r}")
        return found

    async def complete(self, messages: list[dict], model: str, max_tokens: int) -> dict:
        errors = []
        for p in self.candidates(model):
            cb = self.breakers[p.name]
            if not await cb.allow():
                errors.append(f"{p.name}: circuit open")
                continue
            try:
                out = await p.complete(messages, model, max_tokens)
            except ProviderError as exc:
                if not exc.failover:
                    raise FatalError(f"{p.name}: {exc}") from exc
                await cb.record_failure()
                errors.append(f"{p.name}: {exc}")
                continue
            await cb.record_success()
            return out | {"provider": p.name}
        raise RetryableError("all providers failed: " + "; ".join(errors))

    async def stream(self, messages: list[dict], model: str, max_tokens: int
                     ) -> AsyncIterator[tuple[str, object]]:
        """Yield ("provider", name) once, then ("delta", text)… and ("usage", dict)."""
        errors = []
        for p in self.candidates(model):
            cb = self.breakers[p.name]
            if not await cb.allow():
                errors.append(f"{p.name}: circuit open")
                continue
            events = p.stream(messages, model, max_tokens)
            try:  # always close the upstream HTTP stream (failover, error, client gone)
                try:
                    first = await anext(events)  # failover is only safe before this
                except StopAsyncIteration:
                    first = None
                except ProviderError as exc:
                    if not exc.failover:
                        raise FatalError(f"{p.name}: {exc}") from exc
                    await cb.record_failure()
                    errors.append(f"{p.name}: {exc}")
                    continue
                yield "provider", p.name
                try:
                    if first is not None:
                        yield first
                    async for event in events:
                        yield event
                except ProviderError as exc:
                    await cb.record_failure()
                    raise RetryableError(f"{p.name} failed mid-stream: {exc}") from exc
                await cb.record_success()
                return
            finally:
                await events.aclose()
        raise RetryableError("all providers failed: " + "; ".join(errors))

    async def status(self) -> list[dict]:
        out = []
        for p in self.providers:
            s = await self.breakers[p.name].snapshot()
            started = time.perf_counter()
            reachable = await p.ping()
            out.append({
                "name": p.name,
                "base_url": p.base_url,
                "models": p.models,
                "reachable": reachable,
                "latency_ms": round((time.perf_counter() - started) * 1000, 1),
                "circuit": s.state,
                "failures": s.failures,
                "trips": s.trips,
                "open_until": s.open_until,
            })
        return out
