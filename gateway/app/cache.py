import hashlib
import os

import redis.asyncio as redis

r = redis.from_url(os.environ["REDIS_URL"], decode_responses=True)

TTL_SECONDS = 3600


def make_key(tenant_id: int, prompt: str) -> str:
    digest = hashlib.sha256(prompt.encode()).hexdigest()
    return f"cache:{tenant_id}:{digest}"


async def get_cached(tenant_id: int, prompt: str):
    return await r.get(make_key(tenant_id, prompt))


async def set_cached(tenant_id: int, prompt: str, answer: str):
    await r.set(make_key(tenant_id, prompt), answer, ex=TTL_SECONDS)