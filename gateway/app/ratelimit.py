import time

from fastapi import Depends, HTTPException, Response

from app import metrics
from app.auth import get_tenant
from app.redis_client import r

WINDOW_S = 60


async def rate_limit(response: Response, tenant: dict = Depends(get_tenant)):
    """Fixed-window limiter (per tenant, per minute) with standard headers."""
    limit = tenant["rate_limit_per_min"]
    now = time.time()
    window = int(now // WINDOW_S)
    reset_in = WINDOW_S - int(now % WINDOW_S)
    key = f"rl:{tenant['id']}:{window}"

    pipe = r.pipeline()
    pipe.incr(key)
    pipe.expire(key, WINDOW_S)
    count, _ = await pipe.execute()

    headers = {
        "X-RateLimit-Limit": str(limit),
        "X-RateLimit-Remaining": str(max(0, limit - count)),
        "X-RateLimit-Reset": str(reset_in),
    }

    if count > limit:
        await metrics.incr_rate_limited(tenant["id"])
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded",
            headers={**headers, "Retry-After": str(reset_in)},
        )

    response.headers.update(headers)
    return tenant


async def current_usage(tenant_id: int) -> int:
    window = int(time.time() // WINDOW_S)
    value = await r.get(f"rl:{tenant_id}:{window}")
    return int(value or 0)
