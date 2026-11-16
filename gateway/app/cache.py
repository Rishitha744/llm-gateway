"""Response cache, scoped per tenant (key derivation shared with workers)."""
import json

from app import config
from app.redis_client import r
from common.cache_key import make_key


async def get_cached(tenant_id: int, model: str, messages: list[dict], max_tokens: int):
    raw = await r.get(make_key(tenant_id, model, messages, max_tokens))
    return json.loads(raw) if raw else None


async def set_cached(tenant_id: int, model: str, messages: list[dict], max_tokens: int, value: dict):
    await r.set(
        make_key(tenant_id, model, messages, max_tokens), json.dumps(value), ex=config.CACHE_TTL_S
    )
