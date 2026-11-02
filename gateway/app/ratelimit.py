import os
import time

import redis.asyncio as redis
from fastapi import Depends, HTTPException

from app.auth import get_tenant

r = redis.from_url(os.environ["REDIS_URL"], decode_responses=True)


async def rate_limit(tenant: dict = Depends(get_tenant)):
    limit = tenant["rate_limit_per_min"]
    window = int(time.time() // 60)
    key = f"rl:{tenant['id']}:{window}"

    pipe = r.pipeline()
    pipe.incr(key)
    pipe.expire(key, 60)
    count, _ = await pipe.execute()

    if count > limit:
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded",
            headers={"Retry-After": "60"},
        )

    return tenant