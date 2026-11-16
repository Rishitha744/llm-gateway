"""Counters for events that never reach Postgres (e.g. rejected requests).

Stored in Redis in 5-minute slots so any chart bucket size can be rebuilt.
"""
import time

from app.redis_client import r

SLOT_S = 300
RETENTION_S = 8 * 86400


async def incr_rate_limited(tenant_id: int):
    key = f"stats:rl:{tenant_id}:{int(time.time() // SLOT_S)}"
    pipe = r.pipeline()
    pipe.incr(key)
    pipe.expire(key, RETENTION_S)
    await pipe.execute()


async def rate_limited_series(
    tenant_ids: list[int], since_epoch: int, until_epoch: int, bucket_s: int
) -> dict[int, int]:
    """Return {bucket_start_epoch: count} summed over tenants."""
    out: dict[int, int] = {}
    if not tenant_ids:
        return out
    slots = list(range(since_epoch // SLOT_S, until_epoch // SLOT_S + 1))
    keys = [f"stats:rl:{t}:{s}" for s in slots for t in tenant_ids]
    values: list = []
    for i in range(0, len(keys), 1000):
        values.extend(await r.mget(keys[i : i + 1000]))
    i = 0
    for s in slots:
        bucket = (s * SLOT_S) // bucket_s * bucket_s
        for _ in tenant_ids:
            if values[i]:
                out[bucket] = out.get(bucket, 0) + int(values[i])
            i += 1
    return out
